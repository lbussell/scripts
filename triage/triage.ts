#!/usr/bin/env bun

import { getPullRequests, getIssues, getPipelineRuns, prefetchAzdoToken, getAzdoPullRequests } from "./triageLib.ts";

const lookbackHours = 48;

const gitHubRepos = [
    "dotnet/dotnet-docker",
    "dotnet/dotnet-docker-internal",
    "dotnet/docker-tools",
    "microsoft/dotnet-framework-docker",
];

const azdoOrg = "dnceng"
const azdoProject = "internal"
const azdoRepos = [
    "dotnet-dotnet-docker",
    "dotnet-docker-tools",
    "dotnet-docker-tools-internal",
]
const pipelineDefinitionScopes = [
    "dotnet/dotnet-docker",
    "dotnet/docker-tools",
    "dotnet/docker-tools-internal",
    "microsoft/dotnet-framework-docker",
]

// Acquire the Azure DevOps access token up front so we fail fast if the user
// isn't logged in via the Azure CLI.
await prefetchAzdoToken();

const pulls = await getPullRequests(gitHubRepos);
pulls.sort((a, b) => a.repo.localeCompare(b.repo) || a.createdAt.localeCompare(b.createdAt));

console.log("\nPull Requests:");
console.table(
    pulls.map(p => ({
        repo: p.repo,
        "#": p.number,
        state: p.state,
        author: p.author,
        title: p.title.length > 60 ? p.title.slice(0, 57) + "..." : p.title,
        labels: p.labels.join(", "),
        created: p.createdAt.slice(0, 10),
    }))
);

const issues = await getIssues(gitHubRepos, { labels: ["untriaged"], excludeLabels: ["vulnerability"] });
issues.sort((a, b) => a.repo.localeCompare(b.repo) || a.createdAt.localeCompare(b.createdAt));

console.log("\nUntriaged Issues:");
console.table(
    issues.map(i => ({
        repo: i.repo,
        "#": i.number,
        state: i.state,
        author: i.author,
        title: i.title.length > 60 ? i.title.slice(0, 57) + "..." : i.title,
        labels: i.labels.join(", "),
        created: i.createdAt.slice(0, 10),
    }))
);

const runs = await getPipelineRuns(azdoOrg, azdoProject, pipelineDefinitionScopes, lookbackHours);
runs.sort((a, b) =>
    a.repository.localeCompare(b.repository)
    || a.definitionName.localeCompare(b.definitionName)
    || b.queueTime.localeCompare(a.queueTime));

console.log(`\nPipeline Runs (last ${lookbackHours}h):`);
console.table(
    runs.map(r => ({
        repo: r.repository,
        pipeline: r.definitionName,
        build: r.buildNumber,
        status: r.status,
        result: r.result,
        reason: r.reason,
        branch: r.sourceBranch.replace(/^refs\/heads\//, ""),
        queued: r.queueTime.slice(0, 16).replace("T", " "),
    }))
);

const azdoPulls = await getAzdoPullRequests(azdoOrg, azdoProject, azdoRepos);
azdoPulls.sort((a, b) => a.repository.localeCompare(b.repository) || a.creationDate.localeCompare(b.creationDate));

console.log("\nAzure DevOps Pull Requests:");
console.table(
    azdoPulls.map(p => ({
        repo: p.repository,
        "#": p.pullRequestId,
        state: p.isDraft ? "DRAFT" : p.status.toUpperCase(),
        author: p.author,
        title: p.title.length > 60 ? p.title.slice(0, 57) + "..." : p.title,
        target: p.targetBranch,
        created: p.creationDate.slice(0, 10),
    }))
);
