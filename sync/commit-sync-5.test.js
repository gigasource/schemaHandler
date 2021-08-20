const { Socket, Io } = require("../io/io");
const ormGenerator = require("./test-utils/ormGenerator");
const { genOrm } = ormGenerator
const delay = require("delay");
const { stringify } = require("../utils");
const lodashMock = require('./test-utils/lodashMock')
const _ = require('lodash')
const { ObjectID } = require('bson')
const md5 = require('md5')
require("mockdate").set(new Date("2021/01/28").getTime());

jest.setTimeout(300000)

describe("[Module] Test mock orm", function() {
  it("Emit orm", async () => {
    const { orm } = await ormGenerator();
    orm.on("test", function() {
      this.value = 10;
    });
    const { value } = orm.emit("test");
    expect(value).toEqual(10);
    expect(orm.emit).toHaveBeenCalled();
  });

  it("Emit with await", async () => {
    const { orm, utils } = await ormGenerator();
    let a;
    orm.on("test", async function() {
      await delay(1000);
      a = 10;
      this.value = 5;
    });
    orm.emit("test");
    const result = await utils.waitAllEmit();
    expect(a).toEqual(10);
    expect(result[0].value).toEqual(5);
  });

  it("Test do query", async () => {
    const { orm } = await ormGenerator();
    let data = await orm("Test").find();
    expect(data).toMatchInlineSnapshot(`Array []`);
    await orm("Test").create({
      a: 1
    });
    data = await orm("Test").find();
    expect(stringify(data)).toMatchInlineSnapshot(`
      Array [
        Object {
          "_id": "ObjectID",
          "a": 1,
        },
      ]
    `);
  });

  it('Test connect socket', async () => {
	  const { orm: ormA, utils: utilsA } = await ormGenerator(["sync-transporter"], {
		  setMaster: true,
		  name: 'A'
	  });
	  ormA.on('commit:sync:master', function () { this.value = [] })
	  const { orm: ormB, utils: utilsB } = await ormGenerator(["sync-transporter"], {
		  setMaster: false,
		  name: 'B'
	  });
	  ormB.socketConnect(ormA.ioId);
	  await ormA.waitForClient(ormB.name)
  })

	it('Test wait hook to be called', async (done) => {
		const { orm, utils } = await ormGenerator()
		orm.on('test', () => {
		})
		utils.waitEventIsCalled('test').then(r => done())
		orm.emit('test')
	})

	it('Test on queue', async () => {
		const { orm, utils } = await ormGenerator()
		orm.on('test', async function () {
			this.value = false
		})
		await orm.emit('test')
		const data = utils.getPromisesOfEvent('test')
		expect(data.length).toEqual(1)
		const result = await Promise.all(data)
		expect(result[0].value).toEqual(false)
	})

	it('Test wait for an event', async () => {
		const { orm, utils } = await ormGenerator()
		let a = 0
		orm.on('test', async () => {
			await new Promise(resolve => {
				setTimeout(resolve, 1000)
			})
			a += 10
		})
		orm.emit('test')
		orm.emit('test')
		await utils.waitForAnEvent('test')
		expect(a).toEqual(20)
	})
});

describe("[Module] Test transporter", function() {
	beforeEach(() => {
		jest.useRealTimers()
		jest.restoreAllMocks()
		jest.resetModules()
	})

	/**
	 * Flow of this case:
	 *  - ormA creates 10 commits
	 *  - ormB sync with ormA
	 */
  it("Case 1: Transporter", async () => {
  	lodashMock()
    const { orm: ormA, utils: utilsA } = await ormGenerator(["sync-transporter"], {
      setMaster: true,
	    name: 'A'
    });
    const { orm: ormB, utils: utilsB } = await ormGenerator(["sync-transporter"], {
      setMaster: false,
	    name: 'B'
    });
    ormB.socketConnect(ormA.ioId);
    await ormA.waitForClient(ormB.name)
    await utilsA.mockCommits(10)
	  ormA.on('commit:sync:master', async function (clientHighestId) {
		  this.value = await ormA('Commit').find({id: {$gt: clientHighestId}}).limit(5)
	  })
	  ormB.on('transport:requireSync:callback', async function (commits) {
	  	if (commits.length && _.last(commits).id)
	  		await ormB('CommitData').updateOne({}, { highestCommitId: _.last(commits).id }, { upsert: true })
	  })
	  ormB.on('getHighestCommitId', async function () {
	  	const commitData = await ormB('CommitData').findOne()
	  	this.value = commitData ? commitData.highestCommitId : 0
	  })
	  ormA.emit('master:transport:sync')
	  await utilsB.waitToSync(10)
  }, 30000);

	/**
	 * Flow of this case:
	 *  - socket from ormB to ormA disconnected
	 *  - after 10 seconds, promise from transport:require-sync hook of ormB return false
	 */
	it('Case 2: Socket is disconnected, promise must be resolve after 10 seconds', async () => {
  	jest.useFakeTimers()
	  lodashMock()
	  const { orm: ormA, utils: utilsA } = await ormGenerator(["sync-transporter"], {
		  setMaster: true,
		  name: 'A'
	  });
	  const { orm: ormB, utils: utilsB } = await ormGenerator(["sync-transporter"], {
		  setMaster: false,
		  name: 'B'
	  });
	  ormB.socketConnect(ormA.ioId);
	  jest.advanceTimersByTime(100)
	  await ormA.waitForClient(ormB.name)
		ormB.socket.fakeDisconnect()
	  await utilsA.mockCommits(1)
	  ormA.emit('master:transport:sync')
	  await utilsB.waitEventIsCalled('transport:require-sync')
	  const listPromises = utilsB.getPromisesOfEvent('transport:require-sync')
	  expect(listPromises.length).toEqual(1)
	  jest.advanceTimersByTime(10000)
	  const promisesResult = await Promise.all(listPromises)
	  expect(promisesResult[0].value).toEqual(false)
  }, 30000)

	/**
	 * Flow of this case:
	 *  - socket from ormB to ormA disconnected
	 *  - before 10 seconds, promise can't be resolved
	 */
	it('Case 3: Socket is disconnected, promise must not be resolved before 10 seconds', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orm: ormA, utils: utilsA } = await ormGenerator(["sync-transporter"], {
			setMaster: true,
			name: 'A'
		});
		const { orm: ormB, utils: utilsB } = await ormGenerator(["sync-transporter"], {
			setMaster: false,
			name: 'B'
		});
		ormB.socketConnect(ormA.ioId);
		jest.advanceTimersByTime(100)
		await ormA.waitForClient(ormB.name)
		ormB.socket.fakeDisconnect()
		await utilsA.mockCommits(1)
		ormA.emit('master:transport:sync')
		await utilsB.waitEventIsCalled('transport:require-sync')
		const listPromises = utilsB.getPromisesOfEvent('transport:require-sync')
		expect(listPromises.length).toEqual(1)
		listPromises[0].then(r => done('Error'))
		await jest.advanceTimersByTime(8000)
		done()
	})

	/**
	 * Flow of this case:
	 *  - Socket from ormB to ormA disconnected
	 *  - only 1 doSend action is triggered
	 */
	it('Case 4: Use with queue and can not send to master', async (done) => {
		lodashMock()
		const { orm, utils } = await ormGenerator(["sync-transporter", 'sync-queue-commit'])
		orm.on('transport:send', async () => {
			await new Promise(resolve => {})
		})
		utils.waitEventIsCalled('queue:send', 2).then(r => done('error'))
		orm.emit('transport:toMaster', {
			id: 1
		})
		orm.emit('transport:toMaster', {
			id: 2
		})
		await utils.waitEventIsCalled('transport:send')
		expect(utils.getNumberOfTimesOnCalled('queue:send')).toEqual(1)
		done()
	})

	it('Case 5: Send transport:require-sync twice', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orm: ormA, utils: utilsA } = await ormGenerator(["sync-transporter"], {
			setMaster: true,
			name: 'A'
		});
		const { orm: ormB, utils: utilsB } = await ormGenerator(["sync-transporter"], {
			setMaster: false,
			name: 'B'
		});
		ormB.socketConnect(ormA.ioId);
		jest.advanceTimersByTime(100)
		await ormA.waitForClient(ormB.name)
		ormB.isFakeDisconnect = true
		ormB.emit('transport:require-sync')
		ormB.emit('transport:require-sync')
		const transportRequireSyncOn = _.get(ormB._events, 'transport:require-sync')
		done()
	})
});

describe("[Module] Fake doc", function () {
	beforeEach(async (done) => {
		jest.useRealTimers()
		jest.restoreAllMocks()
		jest.resetModules()
		await delay(200)
		done()
	})

	it('Case 1: Create fake', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		const createResult = await orm('Model').create({ test: 1 })
		const models = await orm('Model').find().direct()
		const modelsFake = await orm('RecoveryModel').find().direct()
		const modelsFakeWithFind = await orm('Model').find()
		expect(stringify(createResult)).toMatchSnapshot()
		expect(stringify(models)).toMatchSnapshot()
		expect(stringify(modelsFake)).toMatchSnapshot()
		expect(stringify(modelsFakeWithFind)).toMatchSnapshot()
		done()
	})

	it('Case 2: Find one and update', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		await orm('Model').create({ test: 1 })
		const findResult = await orm('Model').findOneAndUpdate({}, { test: 2 })
		const models = await orm('Model').find().direct()
		const modelsFake = await orm('RecoveryModel').find().direct()
		expect(stringify(findResult)).toMatchSnapshot()
		expect(stringify(models)).toMatchSnapshot()
		expect(stringify(modelsFake)).toMatchSnapshot()
		done()
	})

	it('Case 2-a: Find one and update', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		await orm('Model').create({ test: 1 }).direct()
		const findResult = await orm('Model').findOneAndUpdate({}, { test: 2 })
		const models = await orm('Model').find().direct()
		const modelsFake = await orm('RecoveryModel').find().direct()
		expect(stringify(findResult)).toMatchSnapshot()
		expect(stringify(models)).toMatchSnapshot()
		expect(stringify(modelsFake)).toMatchSnapshot()
		done()
	})

	it('Case 3: Update then find', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		await orm('Model').create({ test: 1 })
		await orm('Model').updateOne({}, { test: 2 })
		const findResult = await orm('Model').find()
		const models = await orm('Model').find().direct()
		const modelsFake = await orm('RecoveryModel').find().direct()
		expect(stringify(findResult)).toMatchSnapshot()
		expect(stringify(models)).toMatchSnapshot()
		expect(stringify(modelsFake)).toMatchSnapshot()
		done()
	})

	it('Case 4: Query delete', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		await orm('Model').create({ test: 1 }).direct()
		await orm('Model').delete({ test: 1 })
		const findResult = await orm('Model').find()
		const models = await orm('Model').find().direct()
		const modelsFake = await orm('RecoveryModel').find().direct()
		expect(stringify(findResult)).toMatchSnapshot()
		expect(stringify(models)).toMatchSnapshot()
		expect(stringify(modelsFake)).toMatchSnapshot()
		done()
	})

	it('Case 5: Handle remove fake', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		await orm('Model').create({ test: 1 }).direct()
		await orm('Model').delete({ test: 1 })
		await orm.removeFakeOfCollection('Model', { test: 1 })
		const findResult = await orm('Model').find()
		const models = await orm('Model').find().direct()
		const modelsFake = await orm('RecoveryModel').find().direct()
		expect(stringify(findResult)).toMatchSnapshot()
		expect(stringify(models)).toMatchSnapshot()
		expect(stringify(modelsFake)).toMatchSnapshot()
		done()
	})

	it('Case 6: With master and 2 clients', async function (done) {
		let findDataOrm1
		let findDataOrm2
		let findDataOrm0
		let findRealDataOrm1
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(3,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].socketConnect(orms[0].ioId)
		orms[2].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100)
		utils[1].setLockEvent('transport:send', true)
		const doc = await orms[0]('Model').create({ test: 1 })
		await utils[1].waitToSync(1)
		await utils[2].waitToSync(1)
		await orms[1]('Model').updateOne({ test: 1 }, { test: 2 })
		findDataOrm1 = await orms[1]('Model').findOne()
		findRealDataOrm1 = await orms[1]('Model').findOne().direct()
		findDataOrm2 = await orms[2]('Model').findOne()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		expect(stringify(findRealDataOrm1)).toMatchSnapshot()
		expect(stringify(findDataOrm2)).toMatchSnapshot()
		await orms[0]('Model').updateOne({ _id: doc._id }, { arr: [{ test : 1 }] })
		await utils[1].waitToSync(2)
		await utils[2].waitToSync(2)
		findDataOrm1 = await orms[1]('Model').findOne()
		findDataOrm0 = await orms[0]('Model').findOne()
		expect(stringify(findDataOrm0)).toMatchSnapshot()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		await orms[2]('Model').updateOne({}, { $push: { arr: { test: 3 } }})
		await utils[1].waitToSync(3)
		await utils[2].waitToSync(3)
		findDataOrm1 = await orms[1]('Model').findOne()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		done()
	})

	it('Case 7: Case delete and then master update', async function (done) {
		let findDataOrm1
		let findDataOrm0

		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100)
		utils[1].setLockEvent('transport:send', true)
		const doc = await orms[0]('Model').create({ test: 1 })
		await utils[1].waitToSync(1)
		await orms[1]('Model').deleteOne({ _id: doc._id })
		findDataOrm1 = await orms[1]('Model').findOne()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		await orms[0]('Model').updateOne({ _id: doc._id }, { test: 2 })
		findDataOrm0 = await orms[0]('Model').findOne()
		expect(stringify(findDataOrm0)).toMatchSnapshot()
		findDataOrm1 = await orms[1]('Model').findOne()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		done()
	})

	it('Case 8: Create and do a query update', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		await orm('Model').create({ test: 1 })
		await orm('Model').updateOne({ test: 1 }, { test: 2 })
		const findResult = await orm('Model').find()
		const models = await orm('Model').find().direct()
		const modelsFake = await orm('RecoveryModel').find().direct()
		expect(stringify(findResult)).toMatchSnapshot()
		expect(stringify(models)).toMatchSnapshot()
		expect(stringify(modelsFake)).toMatchSnapshot()
		done()
	})

	it('Case 9: Reapply query after remove fake', async function (done) {
		let findDataOrm1
		let findDataOrm0

		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100)
		utils[1].setLockEvent('transport:send', true)
		const doc = await orms[0]('Model').create({ arr: [{ test: 1 }] })
		await utils[1].waitToSync(1)
		await orms[1]('Model').updateOne({ _id: doc._id }, { test: 2 })
		findDataOrm1 = await orms[1]('Model').findOne()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		await orms[0]('Model').updateOne({ _id: doc._id }, { $push: { arr: { test: 2 } } })
		await utils[1].waitToSync(2)
		findDataOrm0 = await orms[0]('Model').findOne()
		expect(stringify(findDataOrm0)).toMatchSnapshot()
		findDataOrm1 = await orms[1]('Model').findOne()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		utils[1].setLockEvent('transport:send', false)
		utils[0].setLockEvent('master:transport:sync', true)
		await orms[1].emit('queue:send')
		utils[1].setLockEvent('transport:send', true)
		utils[0].setLockEvent('master:transport:sync', false)
		await orms[1]('Model').updateOne({ _id: doc._id }, { test: 3 })
		orms[0].emit('master:transport:sync')
		await utils[1].waitToSync(3)
		findDataOrm1 = await orms[1]('Model').findOne()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		done()
	})

	it('Case 10: Reapply query and remove only 1 fake doc', async function (done) {
		let findDataOrm1
		let findDataOrm0

		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100)
		utils[1].setLockEvent('transport:send', true)
		const doc = await orms[0]('Model').create({ arr: [{ test: 1 }] }) // 1
		await utils[1].waitToSync(1)
		await orms[1]('Model').updateOne({ _id: doc._id }, { test: 2 }) // 2
		await orms[1]('Model').create({ secondDoc: true }) // 3
		findDataOrm1 = await orms[1]('Model').find()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		await orms[0]('Model').updateOne({ _id: doc._id }, { $push: { arr: { test: 2 } } }) // 4
		await utils[1].waitToSync(2)
		findDataOrm0 = await orms[0]('Model').findOne()
		expect(stringify(findDataOrm0)).toMatchSnapshot()
		findDataOrm1 = await orms[1]('Model').find()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		utils[1].setLockEvent('transport:send', false)
		utils[0].setLockEvent('master:transport:sync', true)
		await orms[1].emit('queue:send')
		utils[1].setLockEvent('transport:send', true)
		utils[0].setLockEvent('master:transport:sync', false)
		await orms[1]('Model').updateOne({ _id: doc._id }, { test: 3 })
		orms[0].emit('master:transport:sync')
		await utils[1].waitToSync(4)
		findDataOrm1 = await orms[1]('Model').find()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		const commitData = await orms[1]('CommitData').find()
		expect(stringify(commitData)).toMatchSnapshot()
		done()
	})

	it('Case 11: findOneAndUpdate fake', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		const doc = await orm('Model').create({ test: [] })
		const docAfterQuery = await orm('Model').findOneAndUpdate({ _id: doc._id }, { $push: { test: 1 } })
		expect(stringify(doc)).toMatchSnapshot()
		expect(stringify(docAfterQuery)).toMatchSnapshot()
		const realDoc = await orm('Model').findOne({ _id: doc._id })
		expect(stringify(realDoc)).toMatchSnapshot()
		done()
	})

	it('Case 12: find with sort', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		await orm('Model').create({ test: -1 }).direct()
		await orm('Model').create({ test: 1 })
		await orm('Model').create({ test: 2 })
		const docs = await orm('Model').find().sort({ test: -1 })
		expect(stringify(docs)).toMatchSnapshot()
		const limitDocs = await orm('Model').find().sort({ test: -1 }).limit(1)
		expect(stringify(limitDocs)).toMatchSnapshot()
		done()
	})

	/**
	 * Number of docs in both fake collection and real collection must be greater than skip number
	 */
	it('Case 13: find with skip', async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		await orm('Model').create({ test: 3 }).direct()
		await orm('Model').create({ test: 4 }).direct()
		await orm('Model').create({ test: 1 })
		await orm('Model').create({ test: 2 })
		const docs = await orm('Model').find().sort({test: 1}).skip(1)
		expect(stringify(docs)).toMatchSnapshot()
		done()
	})

	it('Case 14: find after update fake', async function (done) {
		jest.useFakeTimers()
		let findDataOrm
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		const doc = await orm('Model').create({ test: 3 }).direct()
		await orm('Model').updateOne({ _id: doc._id }, { test: 4 })
		findDataOrm = await orm('Model').find({ test: 3 })
		expect(stringify(findDataOrm)).toMatchSnapshot()
		findDataOrm = await orm('Model').findOne({ test: 3 })
		expect(stringify(findDataOrm)).toMatchSnapshot()
		done()
	})
})

describe("[Module] Test bulk write", function () {
	beforeEach(async (done) => {
		jest.useRealTimers()
		jest.restoreAllMocks()
		jest.resetModules()
		await delay(400)
		done()
	})

	it("Case 1: Test bulk write with client", async function () {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		let id = () => "5fb7f13453d00d8aace1d89b";
		const filter1 = { "f0._id": id() };
		const update = { $set: { "items.$[f0].quantity": "100" } };
		await orm('Model').bulkWrite([
			{
				insertOne: {
					document: {
						table: 10,
						items: [{ name: "A", id: 0, _id: id() }]
					}
				}
			},
			{
				updateOne: {
					filter: { table: 10 },
					update,
					arrayFilters: [filter1]
				}
			}
		])
		const result = await orm("Model").find();
		expect(stringify(result)).toMatchSnapshot()
	})

	it("Case 2: Test bulk write 2", async function () {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		let id = () => "5fb7f13453d00d8aace1d89b";
		const update = { $push: { arr: { test: 1 } } };
		await orm('Model').bulkWrite([
			{
				insertOne: {
					document: {
						table: 10,
						items: [{ name: "A", id: 0, _id: id(), arr: [] }]
					}
				}
			},
			{
				updateOne: {
					filter: { table: 10 },
					update
				}
			}
		])
		const result = await orm("Model").find();
		expect(stringify(result)).toMatchSnapshot()
		await orm('Model').bulkWrite([
			{
				deleteMany: {
					filter: {
						_id: result[0]._id.toString()
					}
				}
			}
		])
		expect((await orm("Model").find()).length).toEqual(0)
	})

	it("Case 2: Test bulk write 3", async function (done) {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: false,
			name: 'B'
		});
		await utils.mockModelAndCreateCommits(0)
		let id = () => "5fb7f13453d00d8aace1d89b";
		const update = { $push: { arr: { test: 1 } } };
		await orm('Model').bulkWrite([
			{
				insertOne: {
					document: {
						_id: id()
					}
				}
			},
			{
				insertOne: {
					document: {
						test: 1
					}
				}
			},
			{
				insertOne: {
					document: {
						_id: id()
					}
				}
			},
			{
				insertOne: {
					document: {
						test: 1
					}
				}
			}
		])
		const result = await orm("Model").find();
		expect(stringify(result)).toMatchSnapshot()
		done()
	})

	it("Case 3: Bulk write with master", async function (done) {
		let findDataOrm1
		let findDataOrm0

		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].emit('commit:setBulkWriteThreshold', 0)
		let id = () => "5fb7f13453d00d8aace1d89b";
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100)
		utils[1].setLockEvent('master:transport:sync', true)
		for (let i = 0; i < 2; i++) {
			await orms[0]('Model').create({ test: 1 })
		}
		await orms[0]('Model').create({ _id: id(), test: 1 })
		await orms[1]('Model').create({ _id: id(), test: 2 })
		await orms[0]('Model').create({ test: 3 })
		utils[1].setLockEvent('master:transport:sync', false)
		await orms[0].emit('master:transport:sync')
		await utils[1].waitToSync(5)
		findDataOrm1 = await orms[1]('Model').find()
		findDataOrm0 = await orms[0]('Model').find()
		expect(findDataOrm1).toEqual(findDataOrm0)
		const commitData = await orms[1]('CommitData').findOne()
		expect(commitData.highestCommitId).toEqual(5)
		done()
	})

	it("Case 4: Test findOneAndUpdate", async function (done) {
		let findDataOrm1
		let findDataOrm0

		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].emit('commit:setBulkWriteThreshold', 0)
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100)
		for (let i = 0; i < 2; i++) {
			await orms[0]('Model').create({ test: 1 })
		}
		await orms[0]('Model').create({ test: 1 })
		await orms[0]('Model').findOneAndUpdate({ test: 1 }, { test: 2 })
		await orms[0]('Model').create({ test: 3 })
		await utils[1].waitToSync(5)
		findDataOrm1 = await orms[1]('Model').find()
		findDataOrm0 = await orms[0]('Model').find()
		expect(findDataOrm1).toEqual(findDataOrm0)
		done()
	})

	it("Case 5: Bulk write with snapshot", async function (done) {
		let findDataOrm1
		let findDataOrm0

		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit',  'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms.forEach(orm => {
			orm.setSyncCollection('Model')
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect
		// create a query
		orms[0].emit('commit:setSnapshotCache', 10)
		await orms[0]('Model').create({ table: 10 })
		await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		await utils[1].waitToSync(2)
		orms[1].socket.isFakeDisconnect = true
		for (let i = 0; i < 4; i++) {
			await orms[0]('Model').create({ table: i })
		}
		orms[0].on('snapshot-done', async () => {
			orms[1].socket.isFakeDisconnect = false
			jest.advanceTimersByTime(10000)
			orms[0].emit('master:transport:sync', 12)
			const commitData0 = await orms[0]('CommitData').findOne()
			expect(commitData0.highestCommitId).toEqual(12) // 1 dummy commit
			await utils[1].waitToSync(12)
			findDataOrm1 = await orms[1]('Model').find()
			findDataOrm0 = await orms[0]('Model').find()
			for (let doc of findDataOrm0) {
				delete doc.ref
			}
			expect(findDataOrm0).toEqual(findDataOrm1)
			done()
		})
		orms[0].startSyncSnapshot().then(r => r)
	})

	it("Case 6: Bulk write with snapshot (need resync)", async function (done) {
		let findDataOrm1
		let findDataOrm0

		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit',  'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms.forEach(orm => {
			orm.setSyncCollection('Model')
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect
		// create a query
		orms[0].emit('commit:setSnapshotCache', 10)
		for (let i = 0; i < 6; i++) {
			await orms[0]('Model').create({ table: 10 })
			await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		orms[0].on('snapshot-done', async () => {
			orms[1].socketConnect(orms[0].ioId)
			jest.advanceTimersByTime(100) // time to connect
			orms[0].emit('master:transport:sync', 19) // expect highest id is 19
			const commitData0 = await orms[0]('CommitData').findOne()
			expect(commitData0.highestCommitId).toEqual(19) // 1 dummy commit
			await utils[1].waitToSync(19)
			findDataOrm1 = await orms[1]('Model').find()
			findDataOrm0 = await orms[0]('Model').find()
			for (let doc of findDataOrm0) {
				delete doc.ref
			}
			expect(findDataOrm0).toEqual(findDataOrm1)
			done()
		})
		orms[0].startSyncSnapshot().then(r => r)
	})

	it("Case 7: sync bulk write query", async (done) => {
		let findDataOrm1
		let findDataOrm0

		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit',  'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect

		orms[1].emit('commit:setBulkWriteThreshold', 0)
		await orms[0]('Model').bulkWrite([
			{
				insertOne: {
					document: {
						table: 10
					}
				}
			},
			{
				updateOne: {
					filter: { table: 10 },
					update: { table: 9 }
				}
			}
		])
		await utils[1].waitToSync(1)
		findDataOrm1 = await orms[1]('Model').find()
		findDataOrm0 = await orms[0]('Model').find()
		expect(findDataOrm1).toEqual(findDataOrm0)
		done()
	})

	it('Case 8: Update bulkwrite', async (done) => {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: true,
			name: 'B'
		});
		await orm('Model').create({
			a: 1
		})
		await orm('Model').bulkWrite([
			{
				updateOne: {
					filter: {},
					update: { b: 1 }
				}
			}
		])
		const result = await orm('Model').find()
		expect(stringify(result)).toMatchSnapshot()
		done()
	})

	it('Case 9: Bulkwrite with fake', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		let findDataOrm1
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit',  'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect

		await orms[1]('Model').create({ test: 1 })
		await utils[1].waitToSync(1)
		findDataOrm1 = await orms[1]('Model').find()
		const doc = findDataOrm1[0]
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		findDataOrm1 = await orms[1]('Model').find().direct()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		await orms[0]('Model').bulkWrite([
			{
				updateOne: {
					filter: {
						_id: doc._id.toString()
					},
					update: {
						$set: {
							a: 1
						}
					}
				}
			}
		])
		await utils[1].waitToSync(2)
		findDataOrm1 = await orms[1]('Model').find()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		findDataOrm1 = await orms[1]('Model').find().direct()
		expect(stringify(findDataOrm1)).toMatchSnapshot()
		done()
	})
})

describe('[Integration] Test all plugins', function () {
	beforeEach(async (done) => {
		jest.useRealTimers()
		jest.restoreAllMocks()
		jest.resetModules()
		await delay(300)
		done()
	})

	/**
	 * Flow of this case:
	 *  - set cache_threshold of master to 5
	 *  - ormA create 10 commits
	 *  - ormA then creates 10 more commits
	 *  - ormA then delete the commit highest id
	 *  - query expect to return from cache with highest id 20
	 */
	it('[Sync-multi] Case 1: Cache commits when clients call require-sync in master', async () => {
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi'], {
			setMaster: true
		})
		orm.emit('commit:cacheThreshold', 5)
		await utils.mockModelAndCreateCommits(10)
		// expect this query is get directly from db
		const { value: result1 } = await orm.emit('commit:sync:master', 0)
		const commits = await orm('Commit').find()
		//expect this query is get from cache
		const { value: result2 } = await orm.emit('commit:sync:master', 7)
		expect(_.last(result2).id).toEqual(10)
		await utils.mockModelAndCreateCommits(10)
		// we delete the commit with highestId, so we can confirm that we get commits from cache
		await orm('Commit').deleteOne({ id: 20 })
		await utils.waitForAnEvent('commit:handler:finish')
		const { value: result3 } = await orm.emit('commit:sync:master', 16)
		expect(_.last(result3).id).toEqual(20)
		// set use cache to false
		orm.emit('commit:setUseCacheStatus', false)
		const { value: result4 } = await orm.emit('commit:sync:master', 16)
		expect(_.last(result4).id).toEqual(19)
		// expect set use cache to true gonna set commitsCache to empty
		orm.emit('commit:setUseCacheStatus', true)
		const { value: result5 } = await orm.emit('commit:sync:master', 16)
		expect(_.last(result5).id).toEqual(19)
	})

	it('[Sync-snapshot] Case 2: Client with highest commit id sync with master', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
												['sync-flow', 'sync-plugin-multi', 'sync-transporter',
																'sync-queue-commit', 'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms.forEach(orm => {
			orm.setSyncCollection('Model')
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect
		// create a query
		await orms[0]('Model').create({ table: 10 })
		await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		await utils[1].waitToSync(2)
		orms[0].on('snapshot-done', async () => {
			await utils[0].waitForAnEvent('createCommit')
			const commitsA = await orms[0]('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			const commitsB = await orms[1]('Commit').find()
			expect(stringify(commitsB)).toMatchSnapshot()
			done()
		})
		orms[0].startSyncSnapshot().then(r => r)
	})

	/**
	 * Flow of this case:
	 *  - orms[0] creates 12 commits before orms[1] connects
	 *  - orms[0] start snapshot and orms[1] have to sync 6 commits
	 */
	it('[Sync-snapshot] Case 3: Client need to be resynced', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit', 'sync-snapshot', 'sync-report'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms.forEach(orm => {
			orm.setSyncCollection('Model')
		})
		orms[0].emit('commit:setSnapshotCache', 10)
		for (let i = 0; i < 6; i++) {
			await orms[0]('Model').create({ table: 10 })
			await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		orms[0].on('snapshot-done', async () => {
			const commitData0 = await orms[0]('CommitData').findOne()
			expect(commitData0.highestCommitId).toEqual(19)
			orms[1].socketConnect(orms[0].ioId)
			jest.advanceTimersByTime(100) // time to connect
			await utils[1].waitToSync(19)
			const transportRequireSyncCallback = _.get(orms[1]._events, 'transport:requireSync:callback')
			expect(transportRequireSyncCallback.mock.calls.length).toEqual(1)
			expect(transportRequireSyncCallback.mock.calls[0][0].length).toEqual(6)
			const modelsA = await orms[0]('Model').find()
			const modelsB = await orms[1]('Model').find()
			for (let i = 0; i < modelsA.length; i++) {
				delete modelsA[i].ref
				expect(modelsB[i]).toEqual(modelsA[i])
			}
			const reports = await orms[1]('CommitReport').count()
			expect(reports).toEqual(0)
			done()
		})
		orms[0].startSyncSnapshot()
	})

	/**
	 * Flow of this case:
	 *  - orms[0] sets snapshot cache threshold to 10
	 *  - orms[0] creates 2 commits and orms[1] sync 2 commits
	 *  - orms[0] creates 8 more commits while orms[1] disconnecting
	 *  - orms[0] start snapshot and orms[1] have to sync only commits in cache
	 */
	it('[Sync-snapshot] Case 4: Client do not need to resync', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-report', 'sync-transporter',
				'sync-queue-commit', 'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms.forEach(orm => {
			orm.setSyncCollection('Model')
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect
		orms[0].emit('commit:setSnapshotCache', 10)
		for (let i = 0; i < 1; i++) {
			await orms[0]('Model').create({ table: 10 })
			await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		await utils[1].waitToSync(2)
		orms[1].socket.isFakeDisconnect = true
		for (let i = 0; i < 4; i++) {
			await orms[0]('Model').create({ table: 10 })
			await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		orms[0].on('snapshot-done', async () => {
			orms[1].socket.isFakeDisconnect = false
			jest.advanceTimersByTime(10000)
			orms[0].emit('master:transport:sync')
			const commitData0 = await orms[0]('CommitData').findOne()
			expect(commitData0.highestCommitId).toEqual(16)

			await utils[1].waitToSync(16)
			const transportRequireSyncCallback = _.get(orms[1]._events, 'transport:requireSync:callback')
			expect(transportRequireSyncCallback.mock.calls[3][0].length).toEqual(14)
			await utils[1].waitEventIsCalled('commit:handler:shouldNotExecCommand:Model', 15)
			const listPromises = utils[1].getPromisesOfEvent('commit:handler:shouldNotExecCommand:Model')
			expect(listPromises.length).toEqual(15)
			const resultPromises = await Promise.all(listPromises)
			for (let i = 10; i < resultPromises.length; i++) {
				expect(resultPromises[i]).toEqual(true)
			}
			const reports = await orms[1]('CommitReport').count()
			expect(reports).toEqual(0)
			done()
		})
		orms[0].startSyncSnapshot()
	})

	it('[Sync report] Case 5: Create prevId', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orm, utils } = await ormGenerator(['sync-flow', 'sync-plugin-multi',
				'sync-queue-commit', 'sync-report'], {
			setMaster: true
		})
		await utils.mockModelAndCreateCommits(10)
		const commits = await orm('Commit').find()
		for (let i = 1; i < commits.length; i++) {
			expect(commits[i].prevId).toEqual(commits[i - 1].id)
		}
		done()
	})

	it('[Sync report] Case 6: wrong prevId', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orm, utils } = await ormGenerator([
			'sync-flow',
			'sync-plugin-multi',
			'sync-report'], {
			setMaster: false
		})
		await orm.emit('transport:requireSync:callback', [
			{ id: 1 },
			{ id: 3, prevId: 2 }
		])
		await utils.waitForAnEvent('commit:handler:finish')
		const commitReport = await orm('CommitReport').find()
		expect(commitReport.length).toEqual(1)
		done()
	})

	it('[Sync report] Case 7: disconnect health check', async (done) => {
		const { orm, utils } = await ormGenerator([
			'sync-report'], {
			setMaster: false
		})
		await orm.emit('commit:report:health-check', 'lan', 'disconnected', new Date())
		await orm.emit('commit:report:health-check', 'lan', 'disconnected', new Date())
		const healthCheckData = await orm('CommitReport').find({
			type: 'health-check'
		})
		expect(healthCheckData.length).toEqual(1)
		done()
	})

	it('[Sync report] Case 8: exec error', async (done) => {
		const { orm, utils } = await ormGenerator([
			'sync-plugin-multi',
			'sync-flow',
			'sync-report'], {
			setMaster: true
		})
		await utils.mockModelAndCreateCommits(0)
		const objId = new ObjectID()
		await orm('Model').create({ _id: objId })
		await orm('Model').create({ _id: objId })
		const report = await orm('CommitReport').find({
			type: 'exec-error'
		})
		expect(report.length).toEqual(1)
		done()
	})

	it('[Sync snapshot] Case 9: Commit delete when client need resync', async (done) => {
		await delay(1000)
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit', 'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms.forEach(orm => {
			orm.setSyncCollection('Model')
		})
		orms[0].emit('commit:setSnapshotCache', 10)
		for (let i = 0; i < 6; i++) {
			await orms[0]('Model').create({ table: 10 })
			await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		orms[0].on('snapshot-done', async () => {
			orms[1].socketConnect(orms[0].ioId)
			jest.advanceTimersByTime(100) // time to connect
			await orms[0]('Model').deleteOne({ table: 10 })
			await utils[1].waitToSync(20)
			const commitDataA = await orms[0]('CommitData').findOne()
			const commitDataB = await orms[1]('CommitData').findOne()
			expect(commitDataB.syncData.id).toEqual(commitDataA.syncData.id)
			const models = await orms[1]('Model').count()
			expect(models).toEqual(5)
			done()
		})
		orms[0].startSyncSnapshot()
	})

	it('[Sync reprot] Case 10: Multi md5', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-report', 'sync-transporter',
				'sync-queue-commit', 'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect
		for (let i = 0; i < 5; i++) {
			await orms[0]('Model').create({ table: 10 })
			await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		for (let i = 0; i < 5; i++) {
			await orms[0]('Model').create({ table: 9 })
		}
		await orms[0]('Model').deleteMany({ table: 10 })
		await utils[1].waitToSync(16)
		const commitA = await orms[0]('Commit').find().sort({ id: -1 }).limit(1)
		const commitB = await orms[1]('Commit').find().sort({ id: -1 }).limit(1)
		const modelsA = await orms[0]('Model').find()
		const modelsB = await orms[1]('Model').find()
		expect(commitA).toEqual(commitB)
		expect(modelsA).toEqual(modelsB)
		const commitReport = await orms[1]('CommitReport').count()
		expect(commitReport).toEqual(0)
		done()
	})

	it('[Sync reprot] Case 10-a: Multi md5', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-report', 'sync-transporter',
				'sync-queue-commit', 'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect
		for (let i = 0; i < 5; i++) {
			await orms[0]('Model').create({ table: 10 })
		}
		for (let i = 0; i < 5; i++) {
			await orms[0]('Model').create({ table: 9 })
		}
		await orms[0]('Model').updateMany({ table: 10 }, { name: 'Testing'})
		const data = await orms[0]('Model').find({ table: 10 })
		await utils[1].waitToSync(11)
		const commitA = await orms[0]('Commit').find().sort({ id: -1 }).limit(1)
		const commitB = await orms[1]('Commit').find().sort({ id: -1 }).limit(1)
		const modelsA = await orms[0]('Model').find()
		const modelsB = await orms[1]('Model').find()
		expect(commitA).toEqual(commitB)
		expect(commitA[0].md5).toEqual(md5(data))
		expect(modelsA).toEqual(modelsB)
		const commitReport = await orms[1]('CommitReport').count()
		expect(commitReport).toEqual(0)
		done()
	})

	it('[Sync snapshot] Case 11: Sync snapshot and then mutate to ref doc', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(3,
			['sync-flow', 'sync-plugin-multi', 'sync-report', 'sync-transporter',
				'sync-queue-commit', 'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
		})
		orms.forEach(orm => {
			orm.setSyncCollection('Model')
		})
		orms[1].socketConnect(orms[0].ioId)
		jest.advanceTimersByTime(100) // time to connect
		for (let i = 0; i < 5; i++) {
			await orms[0]('Model').create({ table: i })
			await orms[0]('Model').updateOne({ table: i }, { name: 'Testing' })
		}
		orms[0].on('snapshot-done', async () => {
			orms[0].emit('master:transport:sync')
			const commitData0 = await orms[0]('CommitData').findOne()
			expect(commitData0.highestCommitId).toEqual(16)
			const modelsA = await orms[0]('Model').find()
			for (let model of modelsA) {
				expect(model.ref).toBe(true)
			}
			await utils[1].waitToSync(16)
			await orms[0]('Model').updateOne({ table: 0 }, { name: 'Done' })
			await utils[1].waitToSync(17)
			const commitsA1 = await orms[0]('Commit').find()
			expect(commitsA1[0].chain).not.toBe(undefined)
			for (let i = 1; i < 5; i++) {
				expect(commitsA1[i].chain).toBe(undefined)
			}
			await orms[0]('Model').updateMany({}, { name: 'Done' })
			const commitsA2 = await orms[0]('Commit').find()
			for (let commit of commitsA2) {
				expect(commit.chain).not.toBe(undefined)
			}
			orms[2].socketConnect(orms[0].ioId)
			jest.advanceTimersByTime(100) // time to connect
			await utils[2].waitToSync(18)
			const modelsC = await orms[2]('Model').find()
			const modelsA2 = await orms[0]('Model').find()
			for (let i = 0; i < modelsC.length; i++) {
				delete modelsA2[i].ref
				delete modelsA2[i].snapshot
				expect(modelsC[i]).toEqual(modelsA2[i])
			}
			done()
		})
		orms[0].startSyncSnapshot()
	})

	it('[Sync-snapshot] Case 12: highestCommitId in snapshot is from undeleted collection', async (done) => {
		jest.useFakeTimers()
		lodashMock()
		const { orms, utils } = await genOrm(2,
			['sync-flow', 'sync-plugin-multi', 'sync-transporter',
				'sync-queue-commit', 'sync-snapshot'])
		utils.forEach(util => {
			util.mockModelAndCreateCommits(0)
			util.mockModelAndCreateCommits(0, 'Turbo')
		})
		orms.forEach(orm => {
			orm.setSyncCollection('Model')
		})
		orms[0].emit('commit:setSnapshotCache', 10)
		for (let i = 0; i < 6; i++) {
			await orms[0]('Model').create({ table: 10 })
			await orms[0]('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		await orms[0]('Turbo').create({ test: true })
		orms[0].on('snapshot-done', async () => {
			orms[1].socketConnect(orms[0].ioId)
			jest.advanceTimersByTime(100) // time to connect
			const data = await orms[0]('CommitData').findOne()
			await utils[1].waitToSync(20)
			const models = await orms[1]('Model').count()
			expect(models).toEqual(6)
			done()
		})
		orms[0].startSyncSnapshot()
	})
})
