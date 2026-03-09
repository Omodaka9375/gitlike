// ---------------------------------------------------------------------------
// GitLike — View Components (barrel re-export)
// ---------------------------------------------------------------------------

export { renderHome } from './home.js';
export {
  renderHowItWorks,
  renderForAgents,
  renderRunYourOwn,
  renderCliAuth,
  renderCli,
} from './info-pages.js';
export {
  renderRepo,
  renderTreeOrBlob,
  renderCommits,
  renderRepoHeader,
  renderTreeTable,
  renderCommitList,
} from './repo-view.js';
export { renderCommitDetail } from './commit-detail.js';
export { renderPRList, renderPRDetail } from './pr-views.js';
export { renderFileHistory } from './file-history.js';
export { renderUserProfile } from './user-profile.js';
export { renderStarredRepos } from './starred-repos.js';
export { renderProjectList } from './project-list.js';
export { renderProjectDetail } from './project-detail.js';
