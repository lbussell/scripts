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
    }));
}

export interface RepoActivity {
    repo: string;
    type: string;
    action: string;
    actor: string;
    ref: string;
    target: string;
    title: string;
    url: string;
    createdAt: string;
}

interface GitHubEvent {
    id: string;
    type: string;
    created_at: string;
    actor: { login: string };
    repo: { name: string };
    payload: Record<string, any>;
}

function summarizeEvent(repo: string, e: GitHubEvent): RepoActivity {
    const p = e.payload ?? {};
    let action = p.action ?? "";
    let ref = "";
    let target = "";
    let title = "";
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
            target = `#${pr.number ?? ""}`;
            ref = pr.head?.ref ?? "";
            title = pr.title ?? "";
            url = pr.html_url ?? "";
            break;
        }
        case "PullRequestReviewEvent": {
            const pr = p.pull_request ?? {};
            target = `#${pr.number ?? ""}`;
            title = `review (${p.review?.state ?? ""}): ${pr.title ?? ""}`;
            url = p.review?.html_url ?? pr.html_url ?? "";
            break;
        }
        case "PullRequestReviewCommentEvent":
        case "IssueCommentEvent": {
            const issue = p.issue ?? p.pull_request ?? {};
            target = `#${issue.number ?? ""}`;
            title = `comment: ${issue.title ?? ""}`;
            url = p.comment?.html_url ?? issue.html_url ?? "";
            break;
        }
        case "IssuesEvent": {
            const issue = p.issue ?? {};
            target = `#${issue.number ?? ""}`;
            title = issue.title ?? "";
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
            title = `comment: ${(p.comment?.body ?? "").split("\n")[0] ?? ""}`;
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
        title,
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
        .map(e => summarizeEvent(repo, e));
}
