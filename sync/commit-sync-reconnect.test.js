//<editor-fold desc="declaration">
const Orm = require("../orm");
let ormA = new Orm();
ormA.name = "A";
let ormB = new Orm();
let ormC = new Orm();
ormC.name = "C";
const { ObjectID } = require("bson");
const { stringify } = require("../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;
const { Socket, Io } = require("../io/io");
const masterIo = new Io();
masterIo.listen("local");
const s1 = new Socket();
const Hooks = require("../hooks/hooks");
const hooks = new Hooks();

const Queue = require("queue");
const delay = require("delay");
const syncPlugin = require("./sync-plugin-multi");
let toMasterLockA, toMasterLockC;
const AwaitLock = require("await-lock").default;
const QUEUE_COMMIT_MODEL = 'QueueCommit'
const mockdate = require('mockdate').default
//</editor-fold>

jest.setTimeout(60000)
const tick = () => new Promise(res => setImmediate(res));
jest.useFakeTimers()
describe("commit-sync", function() {
	//<editor-fold desc="Description">
	beforeAll(async (done) => {
		ormA.connect({uri: "mongodb://localhost:27017"}, "myproject");
		ormB.connect({uri: "mongodb://localhost:27017"}, "myproject2");

		let orms = [ormA, ormB];

		for (const orm of orms) {
			orm.plugin(syncPlugin);
			orm.plugin(require('./sync-queue-commit'))
			orm.plugin(require("./sync-transporter"));
		}

		ormA.plugin(require("./sync-flow"), "client");
		ormB.plugin(require("./sync-flow"), "master");
		ormA.emit("initSyncForClient", s1);
		masterIo.on('connect', (socket) => {
			ormB.emit('initSyncForMaster', socket)
		})

		await ormA("Model").remove({}).direct();
		await ormA("Commit").remove({}).direct();
		await ormA("Recovery").remove({}).direct();
		await ormA(QUEUE_COMMIT_MODEL).remove({}).direct()
		await ormB("Model").remove({}).direct();
		await ormB("Commit").remove({}).direct();
		await ormB("Recovery").remove({}).direct();
		await ormB(QUEUE_COMMIT_MODEL).remove({}).direct()

		Model = ormA("Model");

		for (const orm of orms) {
			orm.registerCommitBaseCollection("Model");
		}
		done()
	})

	afterEach(async () => {
		await ormA("Model").remove({}).direct();
		await ormA("Commit").remove({}).direct();
		await ormA("Recovery").remove({}).direct();
		await ormA(QUEUE_COMMIT_MODEL).remove({}).direct()
		await ormB("Model").remove({}).direct();
		await ormB("Commit").remove({}).direct();
		await ormB("Recovery").remove({}).direct();
		await ormB(QUEUE_COMMIT_MODEL).remove({}).direct()
	})

	it("Case queue query from client", async () => {
		jest.useRealTimers()
		mockdate.set('2020-01-01')
		Date.now = jest.fn(() => new Date(Date.UTC(2020, 1, 15)).valueOf())
		await ormA("Model").create({
			value: "test"
		})
		await delay(100)
		const queueCommits = await ormA(QUEUE_COMMIT_MODEL).find({})
		expect(stringify(queueCommits)).toMatchSnapshot()

		s1.connect('local')

		console.log('Delay for 12 secs')
		await delay(12000)
		console.log('Finish delaying')

		const newQueueCommits = await ormA(QUEUE_COMMIT_MODEL).find({})
		expect(stringify(newQueueCommits)).toMatchSnapshot()
	})

	it('Delete queue commit interval', async (done) => {
		mockdate.set('2020-01-01')
		await ormA("Model").create({
			value: "test"
		})
		const queueCommits = await ormA(QUEUE_COMMIT_MODEL).find({})
		expect(stringify(queueCommits)).toMatchSnapshot()
		// await delay(100)
		mockdate.set('2020-01-02')
		jest.advanceTimersByTime(60 * 60 * 1000)
		jest.useRealTimers()
		await delay(200)
		const _queueCommits = await ormA(QUEUE_COMMIT_MODEL).find({})
		expect(stringify(_queueCommits)).toMatchSnapshot()
		done()
	}, 30000)
})
