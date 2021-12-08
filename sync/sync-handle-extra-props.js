function handleExtraProps (orm) {
  const whitelist = orm.getWhiteList();
  orm.on('pre:execChain', -4, function (query) {
    if (!whitelist.includes(query.name)) return;
    if (query.noEffect) {
      return;
    }
    const findCmds = ['find', 'aggregate']
    let findCmd = false;
    for (const {fn} of query.chain) {
      for (const cmd of findCmds) {
        if (fn.includes(cmd)) {
          findCmd = true;
          break;
        }
      }
      if (findCmd) break;
    }
    if (findCmd) {
      orm.once(`proxyMutateResult:${query.uuid}`, async function (_query, result) {
        if (!result.value) return;
        if (!Array.isArray(result.value)) {
          for (const k of Object.keys(result.value).filter(k => k.startsWith('__'))) {
            delete result.value[k];
          }
          return;
        }
        for (const doc of result.value) {
          for (const k of Object.keys(doc).filter(k => k.startsWith('__'))) {
            delete doc[k];
          }
        }
      })
    }
  })
}

module.exports.handleExtraProps = handleExtraProps;
