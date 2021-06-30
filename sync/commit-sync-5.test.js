const { Socket, Io } = require("../io/io");
const ormGenerator = require("./test-utils/ormGenerator");
const delay = require("delay");
const { stringify } = require("../utils");
const lodashMock = require('./test-utils/lodashMock')
const _ = require('lodash')

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
	  const { orm: ormA } = await ormGenerator(["sync-transporter"], {
		  setMaster: true,
		  name: 'A'
	  });
	  const { orm: ormB } = await ormGenerator(["sync-transporter"], {
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
});

describe("[Module] Test transporter", function() {
	beforeEach(() => {
		jest.useRealTimers()
	})

  it("Case 1: Queue retry to send to master", async () => {
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
	  await utilsA.mockCommits(1)
	  ormB.socket.fakeDisconnect()
	  ormA.emit('master:transport:sync')
	  await utilsB.waitEventIsCalled('transport:require-sync')
	  const listPromises = utilsB.getPromisesOfEvent('transport:require-sync')
	  expect(listPromises.length).toEqual(1)
	  jest.advanceTimersByTime(10000)
	  const promisesResult = await Promise.all(listPromises)
	  expect(promisesResult[0].value).toEqual(false)
  }, 30000)

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
		await utilsA.mockCommits(1)
		ormB.socket.fakeDisconnect()
		ormA.emit('master:transport:sync')
		await utilsB.waitEventIsCalled('transport:require-sync')
		const listPromises = utilsB.getPromisesOfEvent('transport:require-sync')
		expect(listPromises.length).toEqual(1)
		listPromises[0].then(r => done('Error'))
		await jest.advanceTimersByTime(8000)
		done()
	})

	it('Case 4: Use with queue and can not send to master', async (done) => {
		jest.useFakeTimers()
		const { orm, utils } = await ormGenerator(["sync-transporter", 'sync-queue-commit'])
		await orm.emit('transport:toMaster', {
			id: 1
		})
		await orm.emit('transport:toMaster', {
			id: 2
		})
		expect(utils.getNumberOfTimesOnCalled('queue:send')).toEqual(1)
	})
});
