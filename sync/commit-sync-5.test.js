const { Socket, Io } = require("../io/io");
const ormGenerator = require("./test-utils/ormGenerator");
const { genOrm } = ormGenerator
const delay = require("delay");
const { stringify } = require("../utils");
const lodashMock = require('./test-utils/lodashMock')
const _ = require('lodash')

jest.setTimeout(30000)

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

describe('[Integration] Test all plugins', function () {
	beforeEach(async (done) => {
		jest.useRealTimers()
		jest.restoreAllMocks()
		jest.resetModules()
		await delay(100)
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
		expect(_.last(result1).id).toEqual(5)
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
			const commitData0 = await orms[0]('CommitData').findOne()
			expect(commitData0.highestCommitId).toEqual(18)
			orms[1].socketConnect(orms[0].ioId)
			jest.advanceTimersByTime(100) // time to connect
			await utils[1].waitToSync(18)
			const transportRequireSyncCallback = _.get(orms[1]._events, 'transport:requireSync:callback')
			expect(transportRequireSyncCallback.mock.calls.length).toEqual(1)
			expect(transportRequireSyncCallback.mock.calls[0][0].length).toEqual(6)
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
			expect(commitData0.highestCommitId).toEqual(15)

			await utils[1].waitToSync(15)
			const transportRequireSyncCallback = _.get(orms[1]._events, 'transport:requireSync:callback')
			expect(transportRequireSyncCallback.mock.calls[2][0].length).toEqual(13)
			await utils[1].waitEventIsCalled('commit:handler:shouldNotExecCommand:Model', 15)
			const listPromises = utils[1].getPromisesOfEvent('commit:handler:shouldNotExecCommand:Model')
			expect(listPromises.length).toEqual(15)
			const resultPromises = await Promise.all(listPromises)
			for (let i = 10; i < resultPromises.length; i++) {
				expect(resultPromises[i]).toEqual(true)
			}
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
})
