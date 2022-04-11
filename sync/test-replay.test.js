const { Socket, Io } = require("../io/io");
const ormGenerator = require("./test-utils/ormGenerator");
const { genOrm, globalHook } = ormGenerator
const delay = require("delay");
const { stringify } = require("../utils");
const lodashMock = require('./test-utils/lodashMock')
const _ = require('lodash')
const { ObjectID } = require('bson')
const md5 = require('md5')
const MockDate = require('mockdate')
jest.setTimeout(300000)
const fs = require('fs')
const path = require('path')

describe('main sync test', function () {
  beforeEach(async (done) => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    jest.resetModules()
    await delay(300)
    globalHook.emit('destroy')
    fs.rmdirSync(path.resolve(__dirname, './db/replay'), { recursive: true })
    done()
  })

  it('Case 1: Test replay basic', async (done) => {
    jest.useFakeTimers()
    lodashMock()
    MockDate.set('2000-11-22');
    const { orms, utils } = await genOrm(1,
      ['sync-flow', 'sync-plugin-multi', 'sync-transporter',
        'sync-queue-commit', 'sync-snapshot', 'sync-replay'])
    utils.forEach(util => {
      util.mockModelAndCreateCommits(0)
    })
    orms.forEach(orm => {
      orm.setSyncCollection('Model')
    })
    orms[0].addSupportedReplayCol('Model')
    await orms[0].startWorker('./sync/sync-utils/store-worker.js', {
      path: '/Users/macbook/Documents/triracle/schemaHandler/sync/db'
    })
    const doc = await orms[0]('Model').create({ table: 10, items: [] })
    MockDate.set('2000-11-23');
    await orms[0]('Model').updateOne({ _id: doc._id }, { table: 11 })
    MockDate.set('2000-11-23 12:12:12');
    await orms[0]('Model').updateOne({ _id: doc._id }, { table: 12 })
    MockDate.set('2000-11-23 12:12:13');
    await orms[0].getAffectedDocInRange(new Date('2000-11-22'), new Date('2000-11-24'))
    const data = orms[0].getReplayDocsAndCommits()
    console.log('Data', data)
    const docIds = Object.keys(data.docs)
    const replayResult = await orms[0].replayDoc(docIds[0], 'Model', 3)
    console.log(replayResult)
    MockDate.set('2000-11-23 12:12:14');
    orms[0].on('snapshot-done', async () => {
      MockDate.set('2000-11-23 12:12:15');
      await orms[0]('Model').updateOne({ _id: doc._id }, { $push: { items: { name: 'Food' } } })
      await orms[0].getAffectedDocInRange(new Date('2000-11-22'), new Date('2000-11-24'))
      const replayResult = await orms[0].replayDoc(docIds[0], 'Model', 6)
      console.log(replayResult)
    })
    orms[0].startSyncSnapshot()
  }, 300000)
})
