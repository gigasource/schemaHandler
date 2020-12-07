const COMMIT_SUFFIX = 'commit:Test'
const { COMMIT_LAYER_TAG } = require('../../../plugins/tags')
const jsonFn = require('json-fn')

module.exports = function (orm) {
  orm.on(`${COMMIT_SUFFIX}`, () => {
  })
  orm.on(`${COMMIT_SUFFIX}:tagA`, async (commit) => {
    const query = jsonFn.parse(commit.query)
    await orm.execChain(query)
    await orm.emit(`${COMMIT_LAYER_TAG}:createCommit`, commit)
  })
  orm.on(`${COMMIT_SUFFIX}:tagB`, () => {
  })
}
