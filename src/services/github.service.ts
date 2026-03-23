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

export interface DetailedRepoInfo {
  name: string
  fullName: string
  description: string | null
  stars: number
  forks: number
  watchers: number
  openIssues: number
  openPRs: number
  defaultBranch: string
  language: string | null
  url: string
  private: boolean
  languages: { [key: string]: number }
  recentCommits: CommitSummary[]
  topContributors: { login: string; contributions: number; avatarUrl: string }[]
  latestRelease: ReleaseSummary | null
}

export interface DetailedPRInfo {
  number: number
  title: string
  body: string | null
  author: string
  state: string
  draft: boolean
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  url: string
  filesChanged: number
  additions: number
  deletions: number
  commits: number
  reviewStatus: {
    approved: number
    changesRequested: number
    commented: number
    pending: number
  }
  ciStatus: {
    conclusion: string | null
    checks: { name: string; conclusion: string | null; status: string }[]
  }
}

export interface WorkflowRunLogs {
  runId: number
  runName: string
  status: string | null
  conclusion: string | null
  jobs: {
    id: number
    name: string
    status: string
    conclusion: string | null
    startedAt: string
    completedAt: string | null
    steps: {
      name: string
      status: string
      conclusion: string | null
      number: number
    }[]
  }[]
}

export interface EnhancedWorkflowRun extends WorkflowRun {
  duration: number | null
  triggeringCommit: {
    sha: string
    message: string
    author: string
  } | null
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

  const prs = await Promise.all(data.map(async (pr) => {
    let ciStatus: string | null = null
    try {
      const { data: checks } = await octokit.checks.listForRef({
        owner, repo, ref: pr.head.sha, per_page: 10,
      })
      const statuses = checks.check_runs.map(c => c.conclusion).filter(Boolean)
      if (statuses.includes('failure')) ciStatus = 'failure'
      else if (statuses.includes('success')) ciStatus = 'success'
      else if (checks.check_runs.some(c => c.status === 'in_progress')) ciStatus = 'pending'
    } catch { ciStatus = null }
    return {
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? 'unknown',
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      url: pr.html_url,
      draft: pr.draft ?? false,
      ciStatus,
    }
  }))
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

export async function listAllPRs(): Promise<PRSummary[]> {
  const repos = await listRepos()
  const top5 = repos.slice(0, 5)
  const results = await Promise.allSettled(
    top5.map(r => {
      const [owner, name] = r.fullName.split('/')
      return listPRs(owner, name)
    })
  )
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
}

export async function listAllIssues(): Promise<IssueSummary[]> {
  const repos = await listRepos()
  const top5 = repos.slice(0, 5)
  const results = await Promise.allSettled(
    top5.map(r => {
      const [owner, name] = r.fullName.split('/')
      return listIssues(owner, name)
    })
  )
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
}

export async function listAllWorkflows(): Promise<WorkflowRun[]> {
  const repos = await listRepos()
  const top5 = repos.slice(0, 5)
  const results = await Promise.allSettled(
    top5.map(r => {
      const [owner, name] = r.fullName.split('/')
      return listWorkflowRuns(owner, name)
    })
  )
  return results
    .flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20)
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

export async function getDetailedRepoInfo(owner: string, repo: string): Promise<DetailedRepoInfo> {
  const octokit = getOctokit()

  // Fetch repo info, languages, commits, contributors, and PRs in parallel
  const [repoData, languagesData, commitsData, contributorsData, prsData, releasesData] = await Promise.all([
    octokit.repos.get({ owner, repo }),
    octokit.repos.listLanguages({ owner, repo }),
    octokit.repos.listCommits({ owner, repo, per_page: 5 }),
    octokit.repos.listContributors({ owner, repo, per_page: 5 }),
    octokit.pulls.list({ owner, repo, state: 'open', per_page: 1 }),
    octokit.repos.listReleases({ owner, repo, per_page: 1 }).catch(() => ({ data: [] })),
  ])

  const recentCommits: CommitSummary[] = commitsData.data.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split('\n')[0],
    author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    date: c.commit.author?.date ?? '',
    url: c.html_url,
  }))

  const topContributors = contributorsData.data.map((c) => ({
    login: c.login ?? 'unknown',
    contributions: c.contributions,
    avatarUrl: c.avatar_url ?? '',
  }))

  const latestRelease = releasesData.data.length > 0
    ? {
        id: releasesData.data[0].id,
        tagName: releasesData.data[0].tag_name,
        name: releasesData.data[0].name ?? null,
        draft: releasesData.data[0].draft,
        prerelease: releasesData.data[0].prerelease,
        createdAt: releasesData.data[0].created_at,
        publishedAt: releasesData.data[0].published_at ?? null,
        author: releasesData.data[0].author?.login ?? 'unknown',
        url: releasesData.data[0].html_url,
      }
    : null

  return {
    name: repoData.data.name,
    fullName: repoData.data.full_name,
    description: repoData.data.description ?? null,
    stars: repoData.data.stargazers_count ?? 0,
    forks: repoData.data.forks_count ?? 0,
    watchers: repoData.data.watchers_count ?? 0,
    openIssues: repoData.data.open_issues_count ?? 0,
    openPRs: prsData.data.length,
    defaultBranch: repoData.data.default_branch ?? 'main',
    language: repoData.data.language ?? null,
    url: repoData.data.html_url,
    private: repoData.data.private,
    languages: languagesData.data,
    recentCommits,
    topContributors,
    latestRelease,
  }
}

export async function getDetailedPRInfo(owner: string, repo: string, pullNumber: number): Promise<DetailedPRInfo> {
  const octokit = getOctokit()

  // Fetch PR info, reviews, and checks in parallel
  const [prData, reviewsData, checksData] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number: pullNumber }),
    octokit.pulls.listReviews({ owner, repo, pull_number: pullNumber }),
    octokit.checks.listForRef({ owner, repo, ref: '', per_page: 100 }).catch(() => ({ data: { check_runs: [] } })),
  ])

  // Get the actual HEAD SHA for checks
  const headSha = prData.data.head.sha
  const actualChecksData = await octokit.checks.listForRef({
    owner,
    repo,
    ref: headSha,
    per_page: 100,
  }).catch(() => ({ data: { check_runs: [] } }))

  // Count review statuses
  const reviewStatus = {
    approved: reviewsData.data.filter(r => r.state === 'APPROVED').length,
    changesRequested: reviewsData.data.filter(r => r.state === 'CHANGES_REQUESTED').length,
    commented: reviewsData.data.filter(r => r.state === 'COMMENTED').length,
    pending: reviewsData.data.filter(r => r.state === 'PENDING').length,
  }

  // CI status
  const checks = actualChecksData.data.check_runs.map(c => ({
    name: c.name,
    conclusion: c.conclusion,
    status: c.status,
  }))

  let conclusion: string | null = null
  if (checks.length > 0) {
    if (checks.some(c => c.conclusion === 'failure')) conclusion = 'failure'
    else if (checks.every(c => c.conclusion === 'success')) conclusion = 'success'
    else if (checks.some(c => c.status === 'in_progress')) conclusion = 'pending'
  }

  return {
    number: prData.data.number,
    title: prData.data.title,
    body: prData.data.body ?? null,
    author: prData.data.user?.login ?? 'unknown',
    state: prData.data.state,
    draft: prData.data.draft ?? false,
    createdAt: prData.data.created_at,
    updatedAt: prData.data.updated_at,
    mergedAt: prData.data.merged_at ?? null,
    url: prData.data.html_url,
    filesChanged: prData.data.changed_files ?? 0,
    additions: prData.data.additions ?? 0,
    deletions: prData.data.deletions ?? 0,
    commits: prData.data.commits ?? 0,
    reviewStatus,
    ciStatus: { conclusion, checks },
  }
}

export async function getWorkflowRunLogs(owner: string, repo: string, runId: number): Promise<WorkflowRunLogs> {
  const octokit = getOctokit()

  // Fetch the workflow run and its jobs
  const [runData, jobsData] = await Promise.all([
    octokit.actions.getWorkflowRun({ owner, repo, run_id: runId }),
    octokit.actions.listJobsForWorkflowRun({ owner, repo, run_id: runId }),
  ])

  const jobs = jobsData.data.jobs.map(job => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion ?? null,
    startedAt: job.started_at,
    completedAt: job.completed_at ?? null,
    steps: job.steps?.map(step => ({
      name: step.name,
      status: step.status,
      conclusion: step.conclusion ?? null,
      number: step.number,
    })) ?? [],
  }))

  return {
    runId: runData.data.id,
    runName: runData.data.name ?? '',
    status: runData.data.status,
    conclusion: runData.data.conclusion ?? null,
    jobs,
  }
}

export async function listEnhancedWorkflowRuns(owner: string, repo: string): Promise<EnhancedWorkflowRun[]> {
  const octokit = getOctokit()
  const { data } = await octokit.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: 20,
  })

  const enhancedRuns = await Promise.all(data.workflow_runs.map(async (r) => {
    // Calculate duration if run is completed
    let duration: number | null = null
    if (r.updated_at && r.created_at) {
      const created = new Date(r.created_at).getTime()
      const updated = new Date(r.updated_at).getTime()
      duration = Math.round((updated - created) / 1000) // seconds
    }

    // Fetch triggering commit info
    let triggeringCommit: { sha: string; message: string; author: string } | null = null
    if (r.head_sha) {
      try {
        const commitData = await octokit.repos.getCommit({ owner, repo, ref: r.head_sha })
        triggeringCommit = {
          sha: commitData.data.sha,
          message: commitData.data.commit.message.split('\n')[0],
          author: commitData.data.author?.login ?? commitData.data.commit.author?.name ?? 'unknown',
        }
      } catch {
        // If commit fetch fails, just set basic info
        triggeringCommit = { sha: r.head_sha, message: '', author: '' }
      }
    }

    return {
      id: r.id,
      name: r.name ?? '',
      status: r.status,
      conclusion: r.conclusion ?? null,
      createdAt: r.created_at,
      url: r.html_url,
      branch: r.head_branch ?? '',
      duration,
      triggeringCommit,
    }
  }))

  return enhancedRuns
}
