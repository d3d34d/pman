// Layers a build-time web baseUrl on top of the static app.json config, without
// affecting local dev or native builds. The GitHub Pages workflow sets
// EXPO_PUBLIC_BASE_URL=/pman so exported web assets resolve under the repo
// subpath; everywhere else it's unset and the app serves from root.
module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_PUBLIC_BASE_URL
  if (baseUrl) {
    config.experiments = { ...(config.experiments || {}), baseUrl }
  }
  return config
}
