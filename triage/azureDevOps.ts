import { $ } from "bun";

export interface PipelineRun {
    org: string;
    project: string;
    repository: string;
    definitionId: number;
    definitionName: string;
    buildId: number;
    buildNumber: string;
    status: string;
    result: string;
    reason: string;
    sourceBranch: string;
    requestedFor: string;
    queueTime: string;
    startTime: string | null;
    finishTime: string | null;
    url: string;
}

// Azure DevOps resource ID for AAD access tokens
const AZDO_RESOURCE_ID = "499b84ac-1321-427f-aa17-267ca6975798";

let azdoTokenPromise: Promise<string> | undefined;

/**
 * Eagerly acquires (and caches) an Azure DevOps access token via the Azure CLI.
 * Call this at script startup to fail fast if the user isn't logged in.
 */
export function prefetchAzdoToken(): Promise<string> {
    if (!azdoTokenPromise) {
        azdoTokenPromise = (async () => {
            const result = await $`az account get-access-token --resource ${AZDO_RESOURCE_ID} --query accessToken -o tsv`.quiet();
            const token = result.stdout.toString().trim();
            if (!token) {
                throw new Error("Failed to acquire Azure DevOps access token via 'az account get-access-token'.");
            }
            return token;
        })();
    }
    return azdoTokenPromise;
}

async function getAzdoToken(): Promise<string> {
    return prefetchAzdoToken();
}

async function azdoGet<T>(url: string): Promise<T> {
    const token = await getAzdoToken();
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Azure DevOps request failed (${response.status} ${response.statusText}): ${url}\n${body}`);
    }
    return await response.json() as T;
}

interface AzdoBuildDefinitionRef {
    id: number;
    name: string;
    path: string;
}

interface AzdoBuild {
    id: number;
    buildNumber: string;
    status: string;
    result?: string;
    reason: string;
    sourceBranch: string;
    queueTime: string;
    startTime?: string;
    finishTime?: string;
    url: string;
    _links?: { web?: { href: string } };
    definition: AzdoBuildDefinitionRef;
    requestedFor?: { displayName?: string; uniqueName?: string };
    repository?: { id?: string; name?: string; type?: string };
}

interface AzdoPagedResponse<T> {
    count: number;
    value: T[];
}

/**
 * Normalizes a pipeline folder path to the form Azure DevOps expects:
 * leading backslash, no trailing slash, backslash separators.
 */
function normalizeFolderPath(folder: string): string {
    let p = folder.replace(/\//g, "\\");
    if (!p.startsWith("\\")) p = "\\" + p;
    if (p.length > 1 && p.endsWith("\\")) p = p.slice(0, -1);
    return p;
}

/**
 * Lists pipeline definitions in the given folder path (recursively).
 */
async function getDefinitionsInFolder(
    org: string,
    project: string,
    folder: string,
): Promise<AzdoBuildDefinitionRef[]> {
    const path = encodeURIComponent(normalizeFolderPath(folder));
    const url =
        `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/build/definitions` +
        `?path=${path}&api-version=7.1`;
    const data = await azdoGet<AzdoPagedResponse<AzdoBuildDefinitionRef>>(url);
    return data.value;
}

/**
 * Gets all pipeline runs (builds) from the given pipeline-folder scopes that were queued
 * within the last `hours` hours.
 *
 * @param org Azure DevOps organization name (e.g., "dnceng").
 * @param project Azure DevOps project name (e.g., "internal").
 * @param folderScopes Pipeline folder paths to include (e.g., ["dotnet/dotnet-docker"]).
 * @param hours Look-back window in hours.
 */
export async function getPipelineRuns(
    org: string,
    project: string,
    folderScopes: string[],
    hours: number,
): Promise<PipelineRun[]> {
    // 1. Resolve all definitions in the requested folders.
    const definitionLists = await Promise.all(
        folderScopes.map(f => getDefinitionsInFolder(org, project, f)),
    );

    const defIdToFolder = new Map<number, string>();
    for (let i = 0; i < folderScopes.length; i++) {
        for (const def of definitionLists[i]!) {
            defIdToFolder.set(def.id, folderScopes[i]!);
        }
    }

    const definitionIds = [...defIdToFolder.keys()];
    if (definitionIds.length === 0) return [];

    // 2. Fetch builds queued in the time window, batching to keep URLs reasonable.
    const minTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const batchSize = 100;
    const builds: AzdoBuild[] = [];
    for (let i = 0; i < definitionIds.length; i += batchSize) {
        const batch = definitionIds.slice(i, i + batchSize);
        const url =
            `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/build/builds` +
            `?definitions=${batch.join(",")}` +
            `&minTime=${encodeURIComponent(minTime)}` +
            `&queryOrder=queueTimeDescending` +
            `&api-version=7.1`;
        const data = await azdoGet<AzdoPagedResponse<AzdoBuild>>(url);
        builds.push(...data.value);
    }

    return builds.map(b => ({
        org,
        project,
        repository: b.repository?.name ?? b.repository?.id ?? "",
        definitionId: b.definition.id,
        definitionName: b.definition.name,
        buildId: b.id,
        buildNumber: b.buildNumber,
        status: b.status,
        result: b.result ?? "",
        reason: b.reason,
        sourceBranch: b.sourceBranch,
        requestedFor: b.requestedFor?.displayName ?? b.requestedFor?.uniqueName ?? "",
        queueTime: b.queueTime,
        startTime: b.startTime ?? null,
        finishTime: b.finishTime ?? null,
        url: b._links?.web?.href ?? b.url,
    }));
}

export interface AzdoPullRequest {
    org: string;
    project: string;
    repository: string;
    pullRequestId: number;
    title: string;
    author: string;
    sourceBranch: string;
    targetBranch: string;
    status: string;
    isDraft: boolean;
    creationDate: string;
    url: string;
}

interface AzdoGitPullRequest {
    pullRequestId: number;
    title: string;
    status: string;
    isDraft: boolean;
    creationDate: string;
    sourceRefName: string;
    targetRefName: string;
    createdBy?: { displayName?: string; uniqueName?: string };
    repository: { id: string; name: string; project?: { name: string } };
    url: string;
    _links?: { web?: { href: string } };
}

/**
 * Gets active pull requests in the given Azure DevOps project, optionally
 * filtered to a set of repositories (by name).
 *
 * @param org Azure DevOps organization name (e.g., "dnceng").
 * @param project Azure DevOps project name (e.g., "internal").
 * @param repositories Optional repository names to include. If omitted, returns PRs across the whole project.
 * @param status PR status filter ("active", "completed", "abandoned", or "all"). Defaults to "active".
 */
export async function getAzdoPullRequests(
    org: string,
    project: string,
    repositories?: string[],
    status: "active" | "completed" | "abandoned" | "all" = "active",
): Promise<AzdoPullRequest[]> {
    const projectSegment = encodeURIComponent(project);
    const fetchAll = async (repoSegment: string): Promise<AzdoGitPullRequest[]> => {
        const all: AzdoGitPullRequest[] = [];
        const pageSize = 100;
        let skip = 0;
        while (true) {
            const url =
                `https://dev.azure.com/${org}/${projectSegment}/_apis/git/${repoSegment}pullrequests` +
                `?searchCriteria.status=${status}` +
                `&$top=${pageSize}&$skip=${skip}` +
                `&api-version=7.1`;
            const data = await azdoGet<AzdoPagedResponse<AzdoGitPullRequest>>(url);
            all.push(...data.value);
            if (data.value.length < pageSize) break;
            skip += pageSize;
        }
        return all;
    };

    let prs: AzdoGitPullRequest[];
    if (repositories && repositories.length > 0) {
        const perRepo = await Promise.all(
            repositories.map(async repo => {
                const seg = `repositories/${encodeURIComponent(repo)}/`;
                return fetchAll(seg);
            }),
        );
        prs = perRepo.flat();
    } else {
        prs = await fetchAll("");
    }

    return prs.map(p => ({
        org,
        project,
        repository: p.repository.name,
        pullRequestId: p.pullRequestId,
        title: p.title,
        author: p.createdBy?.displayName ?? p.createdBy?.uniqueName ?? "",
        sourceBranch: p.sourceRefName.replace(/^refs\/heads\//, ""),
        targetBranch: p.targetRefName.replace(/^refs\/heads\//, ""),
        status: p.status,
        isDraft: p.isDraft,
        creationDate: p.creationDate,
        url: p._links?.web?.href
            ?? `https://dev.azure.com/${org}/${projectSegment}/_git/${encodeURIComponent(p.repository.name)}/pullrequest/${p.pullRequestId}`,
    }));
}
