export const siteVariables = {
  // version-specific
  cliVersion: '1.14.1',
  runtimeVersion: '8.1.0',
  jenkinsenv: '${env.GIT_BRANCH}',
  jenkinsenv1: '${files[*]}',
  jenkinsenv2: '${#files[@]}',
  deploymentid: '${ASTRONOMER_DEPLOYMENT_ID}',
};
