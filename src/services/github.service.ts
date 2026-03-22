import { Octokit } from '@octokit/rest'
import { config } from '../config'

let _octokit: Octokit | null = null

function getOctokit(): Octokit {
  if (!_octokit) {
    _octokit = new Octokit({ auth: config.githubToken || undefined })
  }
  return _octokit
}

export interface RepoSummary {
  name: string
  fullName: string
  description: string | null
  stars: number
  lastPush: string
  openIssues: number
  url: string
  private: boolean
}

export interface PRSummary {
  number: number
  title: string
  author: string
  createdAt: string
  updatedAt: string
  url: string
  draft: boolean
  ciStatus: string | null
}

export interface IssueSummary {
  number: number
  title: string
  author: string
  createdAt: string
  labels: string[]
  url: string
  state: string
}

export interface WorkflowRun {
  id: number
  name: string
  status: string | null
  conclusion: string | null
  createdAt: string
  url: string
  branch: string
}

export interface RepoDetail {
  name: string
  fullName: string
  description: string | null
  stars: number
  forks: number
  watchers: number
  openIssues: number
  size: number
  defaultBranch: string
  language: string | null
  topics: string[]
  license: string | null
  visibility: string
  createdAt: string
  updatedAt: string
  pushedAt: string
  url: string
  private: boolean
}

export interface BranchSummary {
  name: string
  protected: boolean
  sha: string
}

export interface CommitSummary {
  sha: string
  message: string
  author: string
  date: string
  url: string
}

export interface ReleaseSummary {
  id: number
  tagName: string
  name: string | null
  draft: boolean
  prerelease: boolean
  createdAt: string
  publishedAt: string | null
  author: string
  url: string
}

export interface Notification {
  id: string
  reason: string
  title: string
  type: string
  repo: string
  url: string
  updatedAt: string
}

export async function listRepos(org?: string): Promise<RepoSummary[]> {
  const octokit = getOctokit()

  let repos: RepoSummary[] = []

  if (org) {
    const { data } = await octokit.repos.listForOrg({
      org,
      sort: 'pushed',
      per_page: 50,
    })
    repos = data.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      stars: r.stargazers_count ?? 0,
      lastPush: r.pushed_at ?? '',
      openIssues: r.open_issues_count ?? 0,
      url: r.html_url,
      private: r.private,
    }))
  } else {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: 'pushed',
      per_page: 50,
    })
    repos = data.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      stars: r.stargazers_count ?? 0,
      lastPush: r.pushed_at ?? '',
      openIssues: r.open_issues_count ?? 0,
      url: r.html_url,
      private: r.private,
    }))
  }

  return repos
}

export async function listPRs(owner: string, repo: string): Promise<PRSummary[]> {
  const octokit = getOctokit()
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: 'open',
    per_page: 50,
  })

  const prs: PRSummary[] = []

  for (const pr of data) {
    let ciStatus: string | null = null
    try {
      const { data: checks } = await octokit.checks.listForRef({
        owner,
        repo,
        ref: pr.head.sha,
        per_page: 10,
      })
      const statuses = checks.check_runs.map((c) => c.conclusion).filter(Boolean)
      if (statuses.includes('failure')) ciStatus = 'failure'
      else if (statuses.includes('success')) ciStatus = 'success'
      else if (checks.check_runs.some((c) => c.status === 'in_progress')) ciStatus = 'pending'
      else ciStatus = null
    } catch {
      ciStatus = null
    }

    prs.push({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? 'unknown',
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      url: pr.html_url,
      draft: pr.draft ?? false,
      ciStatus,
    })
  }

  return prs
}

export async function listIssues(owner: string, repo: string): Promise<IssueSummary[]> {
  const octokit = getOctokit()
  const { data } = await octokit.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    per_page: 50,
  })

  return data
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      author: i.user?.login ?? 'unknown',
      createdAt: i.created_at,
      labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')),
      url: i.html_url,
      state: i.state,
    }))
}

export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body?: string,
  labels?: string[]
): Promise<IssueSummary> {
  const octokit = getOctokit()
  const { data } = await octokit.issues.create({
    owner,
    repo,
    title,
    body,
    labels,
  })

  return {
    number: data.number,
    title: data.title,
    author: data.user?.login ?? 'unknown',
    createdAt: data.created_at,
    labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')),
    url: data.html_url,
    state: data.state,
  }
}

export async function listWorkflowRuns(owner: string, repo: string): Promise<WorkflowRun[]> {
  const octokit = getOctokit()
  const { data } = await octokit.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: 20,
  })

  return data.workflow_runs.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    status: r.status,
    conclusion: r.conclusion ?? null,
    createdAt: r.created_at,
    url: r.html_url,
    branch: r.head_branch ?? '',
  }))
}

export async function getRepoDetail(owner: string, repo: string): Promise<RepoDetail> {
  const octokit = getOctokit()
  const { data } = await octokit.repos.get({ owner, repo })

  return {
    name: data.name,
    fullName: data.full_name,
    description: data.description ?? null,
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    watchers: data.watchers_count ?? 0,
    openIssues: data.open_issues_count ?? 0,
    size: data.size ?? 0,
    defaultBranch: data.default_branch ?? 'main',
    language: data.language ?? null,
    topics: data.topics ?? [],
    license: data.license?.spdx_id ?? null,
    visibility: data.visibility ?? (data.private ? 'private' : 'public'),
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    pushedAt: data.pushed_at ?? '',
    url: data.html_url,
    private: data.private,
  }
}

export async function listBranches(owner: string, repo: string): Promise<BranchSummary[]> {
  const octokit = getOctokit()
  const { data } = await octokit.repos.listBranches({ owner, repo, per_page: 100 })

  return data.map((b) => ({
    name: b.name,
    protected: b.protected,
    sha: b.commit.sha,
  }))
}

export async function listCommits(
  owner: string,
  repo: string,
  sha?: string,
  perPage = 20
): Promise<CommitSummary[]> {
  const octokit = getOctokit()
  const { data } = await octokit.repos.listCommits({
    owner,
    repo,
    ...(sha ? { sha } : {}),
    per_page: perPage,
  })

  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split('\n')[0],
    author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    date: c.commit.author?.date ?? '',
    url: c.html_url,
  }))
}

export async function listReleases(owner: string, repo: string): Promise<ReleaseSummary[]> {
  const octokit = getOctokit()
  const { data } = await octokit.repos.listReleases({ owner, repo, per_page: 10 })

  return data.map((r) => ({
    id: r.id,
    tagName: r.tag_name,
    name: r.name ?? null,
    draft: r.draft,
    prerelease: r.prerelease,
    createdAt: r.created_at,
    publishedAt: r.published_at ?? null,
    author: r.author?.login ?? 'unknown',
    url: r.html_url,
  }))
}

export async function listNotifications(): Promise<Notification[]> {
  const octokit = getOctokit()
  const { data } = await octokit.activity.listNotificationsForAuthenticatedUser({
    all: false,
    per_page: 50,
  })

  return data.map((n) => ({
    id: n.id,
    reason: n.reason,
    title: n.subject.title,
    type: n.subject.type,
    repo: n.repository.full_name,
    url: n.subject.url ?? '',
    updatedAt: n.updated_at,
  }))
}
