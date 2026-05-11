#!/usr/bin/env bun

import { getAzdoPullRequests, getPipelineRuns, prefetchAzdoToken, type AzdoPullRequest, type PipelineRun } from "./azureDevOps.ts";
import { getGitHubTriage, type GetIssuesOptions, type GetPullRequestsOptions, type Issue, type Pull, type RepoActivity } from "./github.ts";

const lookbackHours = 48;

const azdoOrg = "dnceng"
const azdoProject = "internal"

interface LabelFilterConfig {
    includeLabels?: string[];
    excludeLabels?: string[];
}

interface TriageRepoConfig {
    name: string;
    github?: {
        repo: string;
        pullRequests?: LabelFilterConfig;
        issues?: LabelFilterConfig;
    };
    azdoRepos?: string[];
    azdoPipelineScopes?: string[];
}

const triageRepos: TriageRepoConfig[] = [
    {
        name: "dotnet/dotnet-docker",
        github: {
            repo: "dotnet/dotnet-docker",
            pullRequests: {},
            issues: {
                includeLabels: ["untriaged"],
            },
        },
        azdoRepos: ["dotnet-dotnet-docker"],
        azdoPipelineScopes: ["dotnet/dotnet-docker"],
    },
    {
        name: "dotnet/docker-tools",
        github: {
            repo: "dotnet/docker-tools",
            pullRequests: {},
            issues: {
                includeLabels: ["untriaged"],
            },
        },
        azdoRepos: ["dotnet-docker-tools"],
        azdoPipelineScopes: ["dotnet/docker-tools"],
    },
    {
        name: "microsoft/dotnet-framework-docker",
        github: {
            repo: "microsoft/dotnet-framework-docker",
            pullRequests: {},
            issues: {
                includeLabels: ["untriaged"],
            },
        },
        azdoRepos: ["microsoft-dotnet-framework-docker"],
        azdoPipelineScopes: ["microsoft/dotnet-framework-docker"],
    },
    // {
    //     name: "dotnet/dotnet-docker-internal",
    //     github: {
    //         repo: "dotnet/dotnet-docker-internal",
    //         pullRequests: {},
    //         issues: {
    //             includeLabels: ["untriaged"],
    //             excludeLabels: ["vulnerability"],
    //         },
    //     },
    // },
    {
        name: "dotnet/docker-tools-internal",
        azdoRepos: ["dotnet-docker-tools-internal"],
        azdoPipelineScopes: ["dotnet/docker-tools-internal"],
    },
];

interface RepoInfo {
    pullRequests: Pull[];
    issues: Issue[];
    pipelineRuns: PipelineRun[];
    azdoPullRequests: AzdoPullRequest[];
    otherActivity: RepoActivity[];
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

function toGitHubLabelOptions(config: LabelFilterConfig | undefined): GetIssuesOptions & GetPullRequestsOptions {
    return {
        labels: config?.includeLabels,
        excludeLabels: config?.excludeLabels,
    };
}

const gitHubRepos = triageRepos.flatMap(repo => repo.github ? [{
    repo: repo.github.repo,
    pullRequests: toGitHubLabelOptions(repo.github.pullRequests),
    issues: toGitHubLabelOptions(repo.github.issues),
}] : []);
const azdoRepos = unique(triageRepos.flatMap(repo => repo.azdoRepos ?? []));
const pipelineDefinitionScopes = unique(triageRepos.flatMap(repo => repo.azdoPipelineScopes ?? []));
const repoByGitHubRepo = new Map(triageRepos.flatMap(repo => repo.github ? [[repo.github.repo, repo.name] as const] : []));
const repoByAzdoRepo = new Map(triageRepos.flatMap(repo => (repo.azdoRepos ?? []).map(azdoRepo => [azdoRepo, repo.name] as const)));
const repoByPipelineScope = new Map(triageRepos.flatMap(repo => (repo.azdoPipelineScopes ?? []).map(scope => [scope, repo.name] as const)));

function formatActivityAction(activity: RepoActivity): string {
    const review = activity.title.match(/^review \(([^)]+)\):/);
    if (review) {
        return `review ${review[1]}`;
    }
    if (activity.type === "IssueComment") {
        return "commented";
    }
    if (activity.type === "PullRequestReviewComment") {
        return "review commented";
    }
    if (activity.type === "PullRequest") {
        return `PR ${activity.action}`;
    }
    if (activity.type === "Issues") {
        return `issue ${activity.action}`;
    }
    return [activity.type, activity.action].filter(Boolean).join(" ");
}

function formatMetadata(items: string[]): string {
    const values = items.filter(Boolean);
    return values.length === 0 ? "" : ` (${values.join("; ")})`;
}

function printActivityBullets(activity: RepoActivity[] | undefined): void {
    for (const item of activity ?? []) {
        const when = item.createdAt.slice(0, 16).replace("T", " ");
        console.log(`  - ${when}: @${item.actor} ${formatActivityAction(item)}`);
    }
}

function gitHubItemDate(item: { createdAt: string; activity: RepoActivity[] }): string {
    return item.createdAt || item.activity[0]?.createdAt || "";
}

function pipelineKey(run: PipelineRun): string {
    return `${run.repository}\0${run.definitionName}`;
}

function groupPipelineRuns(runs: PipelineRun[]): Map<string, PipelineRun[]> {
    const grouped = new Map<string, PipelineRun[]>();
    for (const run of runs) {
        const key = pipelineKey(run);
        const items = grouped.get(key);
        if (items) {
            items.push(run);
        } else {
            grouped.set(key, [run]);
        }
    }
    return grouped;
}

function formatRunOutcome(run: PipelineRun): string {
    return run.result || run.status;
}

function formatOutcomeText(outcome: string): string {
    return outcome
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase();
}

function printPipelineRunBullets(runs: PipelineRun[]): void {
    let index = 0;
    while (index < runs.length) {
        const run = runs[index]!;
        const outcome = formatRunOutcome(run);
        let nextIndex = index + 1;
        while (nextIndex < runs.length && formatRunOutcome(runs[nextIndex]!) === outcome) {
            nextIndex++;
        }

        const branch = run.sourceBranch.replace(/^refs\/heads\//, "");
        const when = run.queueTime.slice(0, 16).replace("T", " ");
        console.log(`  - [${run.buildNumber}](${run.url}) ${formatOutcomeText(outcome)} at ${when}${formatMetadata([run.reason, branch])}`);

        const repeatedRuns = nextIndex - index - 1;
        if (repeatedRuns > 0) {
            const runLabel = repeatedRuns === 1 ? "run" : "runs";
            console.log(`  - +${repeatedRuns} more ${runLabel} ${formatOutcomeText(outcome)}`);
        }

        index = nextIndex;
    }
}

function repoNameForGitHubRepo(repo: string): string {
    return repoByGitHubRepo.get(repo) ?? repo;
}

function repoNameForAzdoRepo(repo: string): string {
    return repoByAzdoRepo.get(repo) ?? repo;
}

function repoNameForPipelineRun(run: PipelineRun): string {
    return repoByPipelineScope.get(run.definitionScope) ?? repoNameForAzdoRepo(run.repository);
}

function createRepoInfo(): RepoInfo {
    return {
        pullRequests: [],
        issues: [],
        pipelineRuns: [],
        azdoPullRequests: [],
        otherActivity: [],
    };
}

function hasRepoInfo(info: RepoInfo): boolean {
    return info.pullRequests.length > 0
        || info.issues.length > 0
        || info.pipelineRuns.length > 0
        || info.azdoPullRequests.length > 0
        || info.otherActivity.length > 0;
}

const repoOrder: string[] = [];
const repos = new Map<string, RepoInfo>();

function repoInfo(repo: string): RepoInfo {
    let info = repos.get(repo);
    if (!info) {
        info = createRepoInfo();
        repos.set(repo, info);
        repoOrder.push(repo);
    }
    return info;
}

function printGitHubPullRequests(pulls: Pull[]): void {
    console.log("\n### Pull Requests");
    for (const p of pulls) {
        const labels = p.labels.length > 0 ? `labels: ${p.labels.join(", ")}` : "";
        const timing = p.createdAt ? `created: ${p.createdAt.slice(0, 10)}` : `latest: ${gitHubItemDate(p).slice(0, 16).replace("T", " ")}`;
        console.log(`- [#${p.number}](${p.url}) ${p.state} by @${p.author}${p.title ? `: ${p.title}` : ""}${formatMetadata([labels, timing])}`);
        printActivityBullets(p.activity);
    }
}

function printIssues(issues: Issue[]): void {
    console.log("\n### Issues");
    for (const i of issues) {
        const labels = i.labels.length > 0 ? `labels: ${i.labels.join(", ")}` : "";
        const timing = i.createdAt ? `created: ${i.createdAt.slice(0, 10)}` : `latest: ${gitHubItemDate(i).slice(0, 16).replace("T", " ")}`;
        console.log(`- [#${i.number}](${i.url}) ${i.state} by @${i.author}${i.title ? `: ${i.title}` : ""}${formatMetadata([labels, timing])}`);
        printActivityBullets(i.activity);
    }
}

function printPipelineRuns(runs: PipelineRun[]): void {
    console.log(`\n### Pipeline Runs (last ${lookbackHours}h)`);
    for (const pipelineRuns of groupPipelineRuns(runs).values()) {
        const latest = pipelineRuns[0]!;
        console.log(`- ${latest.definitionName}`);
        printPipelineRunBullets(pipelineRuns);
    }
}

function printAzdoPullRequests(pulls: AzdoPullRequest[]): void {
    console.log("\n### Azure DevOps Pull Requests");
    for (const p of pulls) {
        const state = p.isDraft ? "DRAFT" : p.status.toUpperCase();
        console.log(`- [#${p.pullRequestId}](${p.url}) ${state} by ${p.author}: ${p.title}${formatMetadata([`target: ${p.targetBranch}`, `created: ${p.creationDate.slice(0, 10)}`])}`);
    }
}

function printOtherGitHubActivity(activity: RepoActivity[]): void {
    console.log(`\n### Other GitHub Activity (last ${lookbackHours}h)`);
    for (const item of activity) {
        const title = item.title ? `: ${item.title}` : "";
        console.log(`- ${item.createdAt.slice(0, 16).replace("T", " ")} ${formatActivityAction(item)} by @${item.actor}${formatMetadata([item.target, item.ref])}${title}`);
    }
}

// Acquire the Azure DevOps access token up front so we fail fast if the user
// isn't logged in via the Azure CLI.
await prefetchAzdoToken();

const gitHub = await getGitHubTriage(
    gitHubRepos,
    lookbackHours,
);

const runs = await getPipelineRuns(azdoOrg, azdoProject, pipelineDefinitionScopes, lookbackHours);
runs.sort((a, b) =>
    a.repository.localeCompare(b.repository)
    || a.definitionName.localeCompare(b.definitionName)
    || b.queueTime.localeCompare(a.queueTime));

const azdoPulls = await getAzdoPullRequests(azdoOrg, azdoProject, azdoRepos);
azdoPulls.sort((a, b) => a.repository.localeCompare(b.repository) || a.creationDate.localeCompare(b.creationDate));

for (const repo of triageRepos) {
    repoInfo(repo.name);
}

for (const pull of gitHub.pullRequests) {
    repoInfo(repoNameForGitHubRepo(pull.repo)).pullRequests.push(pull);
}

for (const issue of gitHub.issues) {
    repoInfo(repoNameForGitHubRepo(issue.repo)).issues.push(issue);
}

for (const run of runs) {
    repoInfo(repoNameForPipelineRun(run)).pipelineRuns.push(run);
}

for (const pull of azdoPulls) {
    repoInfo(repoNameForAzdoRepo(pull.repository)).azdoPullRequests.push(pull);
}

for (const item of gitHub.otherActivity) {
    repoInfo(repoNameForGitHubRepo(item.repo)).otherActivity.push(item);
}

for (const repo of repoOrder) {
    const info = repos.get(repo)!;
    if (!hasRepoInfo(info)) {
        continue;
    }

    info.pullRequests.sort((a, b) => gitHubItemDate(a).localeCompare(gitHubItemDate(b)));
    info.issues.sort((a, b) => gitHubItemDate(a).localeCompare(gitHubItemDate(b)));
    info.pipelineRuns.sort((a, b) => a.definitionName.localeCompare(b.definitionName) || b.queueTime.localeCompare(a.queueTime));
    info.azdoPullRequests.sort((a, b) => a.creationDate.localeCompare(b.creationDate));
    info.otherActivity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    console.log(`\n## ${repo}`);
    if (info.pullRequests.length > 0) {
        printGitHubPullRequests(info.pullRequests);
    }
    if (info.issues.length > 0) {
        printIssues(info.issues);
    }
    if (info.pipelineRuns.length > 0) {
        printPipelineRuns(info.pipelineRuns);
    }
    if (info.azdoPullRequests.length > 0) {
        printAzdoPullRequests(info.azdoPullRequests);
    }
    if (info.otherActivity.length > 0) {
        printOtherGitHubActivity(info.otherActivity);
    }
}
