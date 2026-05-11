import { $ } from "bun";

export interface Pull {
    repo: string;
    number: number;
    title: string;
    author: string;
    branch: string;
    state: string;
    url: string;
    isDraft: boolean;
    labels: string[];
    createdAt: string;
    activity: RepoActivity[];
    activityOnly?: boolean;
}

export interface GetPullRequestsOptions {
    /** Only include PRs with all of these labels. */
    labels?: string[];
    /** Exclude PRs that have any of these labels. */
    excludeLabels?: string[];
}

export async function getPullRequests(repo: string, options?: GetPullRequestsOptions): Promise<Pull[]>;
export async function getPullRequests(repos: string[], options?: GetPullRequestsOptions): Promise<Pull[]>;
export async function getPullRequests(
    repoOrRepos: string | string[],
    options: GetPullRequestsOptions = {},
): Promise<Pull[]> {
    if (Array.isArray(repoOrRepos)) {
        return (await Promise.all(repoOrRepos.map(r => getPullRequests(r, options)))).flat();
    }
    const repo = repoOrRepos;
    const labelArgs = (options.labels ?? []).flatMap(l => ["--label", l]);
    // `gh pr list` has no native exclude-label flag, so use `--search` with `-label:"name"`.
    const excludeTerms = (options.excludeLabels ?? []).map(l => `-label:"${l}"`).join(" ");
    const searchArgs = excludeTerms ? ["--search", excludeTerms] : [];
    const result = await $`gh pr list --repo ${repo} ${labelArgs} ${searchArgs} --json number,title,author,headRefName,state,url,isDraft,labels,createdAt`.quiet();
    const items = JSON.parse(result.stdout.toString()) as Array<{
        number: number;
        title: string;
        author: { login: string };
        headRefName: string;
        state: string;
        url: string;
        isDraft: boolean;
        labels: Array<{ name: string }>;
        createdAt: string;
    }>;
    return items.map(item => ({
        repo,
        number: item.number,
        title: item.title,
        author: item.author.login,
        branch: item.headRefName,
        state: item.isDraft ? "DRAFT" : item.state,
        url: item.url,
        isDraft: item.isDraft,
        labels: item.labels.map(l => l.name),
        createdAt: item.createdAt,
        activity: [],
    }));
}

export interface Issue {
    repo: string;
    number: number;
    title: string;
    author: string;
    state: string;
    url: string;
    labels: string[];
    createdAt: string;
    activity: RepoActivity[];
    activityOnly?: boolean;
}

export interface GetIssuesOptions {
    /** Only include issues with all of these labels. */
    labels?: string[];
    /** Exclude issues that have any of these labels. */
    excludeLabels?: string[];
}

export async function getIssues(repo: string, labels?: string[]): Promise<Issue[]>;
export async function getIssues(repos: string[], labels?: string[]): Promise<Issue[]>;
export async function getIssues(repo: string, options?: GetIssuesOptions): Promise<Issue[]>;
export async function getIssues(repos: string[], options?: GetIssuesOptions): Promise<Issue[]>;
export async function getIssues(
    repoOrRepos: string | string[],
    labelsOrOptions: string[] | GetIssuesOptions = {},
): Promise<Issue[]> {
    const options: GetIssuesOptions = Array.isArray(labelsOrOptions)
        ? { labels: labelsOrOptions }
        : labelsOrOptions;
    if (Array.isArray(repoOrRepos)) {
        return (await Promise.all(repoOrRepos.map(r => getIssues(r, options)))).flat();
    }
    const repo = repoOrRepos;
    const labelArgs = (options.labels ?? []).flatMap(l => ["--label", l]);
    // `gh issue list` has no native exclude-label flag, so use `--search` with `-label:"name"`.
    const excludeTerms = (options.excludeLabels ?? []).map(l => `-label:"${l}"`).join(" ");
    const searchArgs = excludeTerms ? ["--search", excludeTerms] : [];
    const result = await $`gh issue list --repo ${repo} ${labelArgs} ${searchArgs} --json number,title,author,state,url,labels,createdAt`.quiet();
    const items = JSON.parse(result.stdout.toString()) as Array<{
        number: number;
        title: string;
        author: { login: string };
        state: string;
        url: string;
        labels: Array<{ name: string }>;
        createdAt: string;
    }>;
    return items.map(item => ({
        repo,
        number: item.number,
        title: item.title,
        author: item.author.login,
        state: item.state,
        url: item.url,
        labels: item.labels.map(l => l.name),
        createdAt: item.createdAt,
        activity: [],
    }));
}

export interface RepoActivity {
    repo: string;
    type: string;
    action: string;
    actor: string;
    ref: string;
    target: string;
    targetKind: "pull" | "issue" | "";
    targetNumber: number | null;
    title: string;
    details: string;
    url: string;
    createdAt: string;
}

export interface GitHubTriage {
    pullRequests: Pull[];
    issues: Issue[];
    otherActivity: RepoActivity[];
}

export interface GitHubTriageRepoConfig {
    repo: string;
    pullRequests?: GetPullRequestsOptions;
    issues?: GetIssuesOptions;
}

interface GitHubEvent {
    id: string;
    type: string;
    created_at: string;
    actor: { login: string };
    repo: { name: string };
    payload: Record<string, any>;
}

function targetKey(repo: string, kind: "pull" | "issue", number: number): string {
    return `${repo}\0${kind}\0${number}`;
}

function isTargetedActivity(activity: RepoActivity): activity is RepoActivity & { targetKind: "pull" | "issue"; targetNumber: number } {
    return (activity.targetKind === "pull" || activity.targetKind === "issue") && activity.targetNumber !== null;
}

function targetTitle(activity: RepoActivity[]): string {
    return activity
        .map(a => a.title.replace(/^review \([^)]+\):\s*/, "").replace(/^comment:\s*/, ""))
        .find(Boolean) ?? "";
}

function getActivityTarget(activity: RepoActivity[]): RepoActivity & { targetKind: "pull" | "issue"; targetNumber: number } {
    const first = activity[0]!;
    if (!isTargetedActivity(first)) {
        throw new Error("Cannot create a GitHub target from non-targeted activity.");
    }
    return first;
}

function representativeTargetEvent(activity: RepoActivity[]): RepoActivity | undefined {
    return activity.find(a =>
        (a.type === "PullRequest" || a.type === "Issues")
        && ["merged", "closed", "opened", "reopened"].includes(a.action))
        ?? activity.find(a => a.type === "PullRequest" || a.type === "Issues")
        ?? activity[0];
}

function targetState(activity: RepoActivity[]): string {
    return representativeTargetEvent(activity)?.action.toUpperCase() ?? "";
}

function targetUrl(repo: string, kind: "pull" | "issue", number: number): string {
    return `https://github.com/${repo}/${kind === "pull" ? "pull" : "issues"}/${number}`;
}

async function getPullRequestTitle(repo: string, number: number): Promise<string> {
    const result = await $`gh pr view ${number} --repo ${repo} --json title --jq .title`.quiet();
    return result.stdout.toString().trim();
}

function pullFromActivity(activity: RepoActivity[]): Pull {
    const first = getActivityTarget(activity);
    const representative = representativeTargetEvent(activity) ?? first;
    return {
        repo: first.repo,
        number: first.targetNumber,
        title: targetTitle(activity),
        author: representative.actor,
        branch: first.ref,
        state: targetState(activity),
        url: targetUrl(first.repo, "pull", first.targetNumber),
        isDraft: false,
        labels: [],
        createdAt: "",
        activity,
        activityOnly: true,
    };
}

function issueFromActivity(activity: RepoActivity[]): Issue {
    const first = getActivityTarget(activity);
    const representative = representativeTargetEvent(activity) ?? first;
    return {
        repo: first.repo,
        number: first.targetNumber,
        title: targetTitle(activity),
        author: representative.actor,
        state: targetState(activity),
        url: targetUrl(first.repo, "issue", first.targetNumber),
        labels: [],
        createdAt: "",
        activity,
        activityOnly: true,
    };
}

function parseTargetNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function formatIssueTarget(number: number | null): string {
    return number === null ? "" : `#${number}`;
}

function textValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function labelName(payload: Record<string, any>): string {
    return textValue(payload.label?.name);
}

function summarizeEvent(repo: string, e: GitHubEvent): RepoActivity {
    const p = e.payload ?? {};
    let action = p.action ?? "";
    let ref = "";
    let target = "";
    let targetKind: RepoActivity["targetKind"] = "";
    let targetNumber: number | null = null;
    let title = "";
    let details = "";
    let url = "";

    switch (e.type) {
        case "PushEvent": {
            ref = (p.ref ?? "").replace(/^refs\/heads\//, "");
            const commits = (p.commits ?? []) as Array<{ message: string; sha: string }>;
            action = `${commits.length} commit${commits.length === 1 ? "" : "s"}`;
            title = commits[0]?.message?.split("\n")[0] ?? "";
            url = `https://github.com/${repo}/commit/${p.head ?? ""}`;
            break;
        }
        case "PullRequestEvent": {
            const pr = p.pull_request ?? {};
            targetKind = "pull";
            targetNumber = parseTargetNumber(pr.number ?? p.number);
            target = formatIssueTarget(targetNumber);
            ref = pr.head?.ref ?? "";
            title = pr.title ?? "";
            details = labelName(p);
            url = pr.html_url ?? "";
            break;
        }
        case "PullRequestReviewEvent": {
            const pr = p.pull_request ?? {};
            targetKind = "pull";
            targetNumber = parseTargetNumber(pr.number);
            target = formatIssueTarget(targetNumber);
            title = `review (${p.review?.state ?? ""}): ${pr.title ?? ""}`;
            details = textValue(p.review?.body);
            url = p.review?.html_url ?? pr.html_url ?? "";
            break;
        }
        case "PullRequestReviewCommentEvent": {
            const pr = p.pull_request ?? {};
            targetKind = "pull";
            targetNumber = parseTargetNumber(pr.number);
            target = formatIssueTarget(targetNumber);
            title = `comment: ${pr.title ?? ""}`;
            details = textValue(p.comment?.body);
            url = p.comment?.html_url ?? pr.html_url ?? "";
            break;
        }
        case "IssueCommentEvent": {
            const issue = p.issue ?? {};
            targetKind = issue.pull_request ? "pull" : "issue";
            targetNumber = parseTargetNumber(issue.number);
            target = formatIssueTarget(targetNumber);
            title = `comment: ${issue.title ?? ""}`;
            details = textValue(p.comment?.body);
            url = p.comment?.html_url ?? issue.html_url ?? "";
            break;
        }
        case "IssuesEvent": {
            const issue = p.issue ?? {};
            targetKind = "issue";
            targetNumber = parseTargetNumber(issue.number);
            target = formatIssueTarget(targetNumber);
            title = issue.title ?? "";
            details = labelName(p);
            url = issue.html_url ?? "";
            break;
        }
        case "CreateEvent":
        case "DeleteEvent": {
            ref = p.ref ?? "";
            target = p.ref_type ?? "";
            break;
        }
        case "ReleaseEvent": {
            const r = p.release ?? {};
            target = r.tag_name ?? "";
            title = r.name ?? "";
            url = r.html_url ?? "";
            break;
        }
        case "ForkEvent": {
            target = p.forkee?.full_name ?? "";
            url = p.forkee?.html_url ?? "";
            break;
        }
        case "WatchEvent":
        case "PublicEvent":
            break;
        case "CommitCommentEvent": {
            target = (p.comment?.commit_id ?? "").slice(0, 7);
            details = textValue(p.comment?.body);
            title = `comment: ${details.split("\n")[0] ?? ""}`;
            url = p.comment?.html_url ?? "";
            break;
        }
        default:
            break;
    }

    return {
        repo,
        type: e.type.replace(/Event$/, ""),
        action,
        actor: e.actor?.login ?? "",
        ref,
        target,
        targetKind,
        targetNumber,
        title,
        details,
        url,
        createdAt: e.created_at,
    };
}

/**
 * Returns GitHub repo activity (PR/issue/push/review/comment/release/etc. events)
 * from the past `hours` hours, using the `/repos/{owner}/{repo}/events` feed.
 *
 * Note: GitHub's events API only retains the ~300 most recent events per repo
 * (≈90 days max). For very busy repos within a long window, older events may be missing.
 */
export async function getRepoActivity(repo: string, hours: number): Promise<RepoActivity[]>;
export async function getRepoActivity(repos: string[], hours: number): Promise<RepoActivity[]>;
export async function getRepoActivity(
    repoOrRepos: string | string[],
    hours: number,
): Promise<RepoActivity[]> {
    if (Array.isArray(repoOrRepos)) {
        return (await Promise.all(repoOrRepos.map(r => getRepoActivity(r, hours)))).flat();
    }
    const repo = repoOrRepos;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const perPage = 100;
    const maxPages = 3; // GitHub caps the events feed at ~300 events / 10 pages.

    const events: GitHubEvent[] = [];
    for (let page = 1; page <= maxPages; page++) {
        const result = await $`gh api --method GET -H "Accept: application/vnd.github+json" /repos/${repo}/events --paginate=false -F per_page=${perPage} -F page=${page}`.quiet();
        const batch = JSON.parse(result.stdout.toString()) as GitHubEvent[];
        if (batch.length === 0) break;
        events.push(...batch);
        // Stop early once we cross the cutoff.
        const oldest = new Date(batch[batch.length - 1]!.created_at).getTime();
        if (oldest < cutoff) break;
        if (batch.length < perPage) break;
    }

    return events
        .filter(e => new Date(e.created_at).getTime() >= cutoff)
        .filter(e => e.type !== "WatchEvent")
        .map(e => summarizeEvent(repo, e));
}

export async function getGitHubTriage(
    repos: GitHubTriageRepoConfig[],
    hours: number,
): Promise<GitHubTriage> {
    const repoNames = repos.map(repo => repo.repo);
    const [pullRequests, issues, activity] = await Promise.all([
        Promise.all(repos.map(repo => getPullRequests(repo.repo, repo.pullRequests))).then(items => items.flat()),
        Promise.all(repos.map(repo => getIssues(repo.repo, repo.issues))).then(items => items.flat()),
        getRepoActivity(repoNames, hours),
    ]);

    activity.sort((a, b) =>
        a.repo.localeCompare(b.repo)
        || b.createdAt.localeCompare(a.createdAt));

    const targetActivity = new Map<string, RepoActivity[]>();
    for (const item of activity) {
        if (!isTargetedActivity(item)) {
            continue;
        }
        const key = targetKey(item.repo, item.targetKind, item.targetNumber);
        const items = targetActivity.get(key);
        if (items) {
            items.push(item);
        } else {
            targetActivity.set(key, [item]);
        }
    }

    const displayedTargetKeys = new Set([
        ...pullRequests.map(p => targetKey(p.repo, "pull", p.number)),
        ...issues.map(i => targetKey(i.repo, "issue", i.number)),
    ]);

    for (const pull of pullRequests) {
        pull.activity = targetActivity.get(targetKey(pull.repo, "pull", pull.number)) ?? [];
    }

    for (const issue of issues) {
        issue.activity = targetActivity.get(targetKey(issue.repo, "issue", issue.number)) ?? [];
    }

    for (const items of targetActivity.values()) {
        const first = getActivityTarget(items);
        if (displayedTargetKeys.has(targetKey(first.repo, first.targetKind, first.targetNumber))) {
            continue;
        }
        if (first.targetKind === "pull") {
            pullRequests.push(pullFromActivity(items));
        } else {
            issues.push(issueFromActivity(items));
        }
    }

    await Promise.all(
        pullRequests
            .filter(p => !p.title)
            .map(async p => {
                p.title = await getPullRequestTitle(p.repo, p.number);
            }),
    );

    const otherActivity = activity.filter(a => !isTargetedActivity(a));

    return {
        pullRequests,
        issues,
        otherActivity,
    };
}
