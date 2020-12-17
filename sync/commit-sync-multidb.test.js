//<editor-fold desc="declaration">
const Orm = require("../orm");
let ormA = new Orm();
ormA.name = "A";
let ormB = new Orm();
ormB.name = "B"
let ormC = new Orm();
ormC.name = "C";
let ormD = new Orm();
ormD.name = "D";
let ormE = new Orm();
const orm = ormA;
const { ObjectID } = require("bson");
const { stringify } = require("../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;
const { Socket, Io } = require("../io/io");
const multiDbIo = new Io();
multiDbIo.listen("local");
const s1 = new Socket();
const s2 = new Socket();
const s3 = new Socket();
const s4 = new Socket();
const Hooks = require("../hooks/hooks");
const hooks = new Hooks();

const delay = require("delay");
const syncPlugin = require("./sync-plugin-multi");
const syncFlow = require('./sync-flow')
const syncTransporter = require('./sync-transporter')

let toMasterLockB

describe('commit-mutliDB', function () {
	beforeAll(async () => {
		ormA.connect({ uri: "mongodb://localhost:27017" });
		ormA.setMultiDbMode()
		ormB.connect({ uri: "mongodb://localhost:27017" }, "myproject2");
		ormC.connect({ uri: "mongodb://localhost:27017" }, "myproject3");
		ormD.connect({ uri: "mongodb://localhost:27017" }, "myproject4");
		ormE.connect({ uri: "mongodb://localhost:27017" }, "myproject5");

		// ormA will do nothing
		// with db1, ormB and ormD are client and ormA is master
		// with db2, ormA and ormE are client and ormC is master
		let orms = [ormB, ormC, ormD, ormE, ormA]
		for (const orm of orms) {
			orm.plugin(syncPlugin)
			orm.plugin(syncFlow)
			orm.plugin(syncTransporter)
			orm.registerCommitBaseCollection("Model");
		}
		orms.pop()

		ormA.emit('commit:flow:setMaster', true, 'db1')
		ormC.emit('commit:flow:setMaster', true)

		await ormA('Model', 'db1').remove({}).direct()
		await ormA('Model', 'db2').remove({}).direct()
		await ormA('Commit', 'db1').remove({}).direct()
		await ormA('Commit', 'db2').remove({}).direct()
		ormA.registerSchema("Model", {
			inProgress: Boolean,
			items: [{}],
			table: Number
		}, 'db1');
		ormA.registerSchema("Model", {
			inProgress: Boolean,
			items: [{}],
			table: Number
		}, 'db2');

		for (const orm of orms) {
			await orm('Model').remove({}).direct()
			await orm('Commit').remove({}).direct()
			await orm('Recovery').remove({}).direct()
			orm.registerSchema("Model", {
				inProgress: Boolean,
				items: [{}],
				table: Number
			});
		}

		multiDbIo.on('connect', socket => {
			if (socket.name !== 'master') {
				ormA.emit('initSyncForMaster', socket, 'db1')
			} else if (socket.name === 'master') {
				ormA.emit('initSyncForClient', socket, 'db2')
			}
		})

		s1.connect('local')
		s2.connect('local')
		s3.connect('local', 'master')

		const ormCIo = new Io()
		ormCIo.listen('ormC')
		ormCIo.on('connect', socket => {
			ormC.emit('initSyncForMaster', socket)
		})
		s4.connect('ormC')
		ormB.emit('initSyncForClient', s1)
		ormD.emit('initSyncForClient', s2)
		ormC.emit('initSyncForMaster', s3)
		ormE.emit('initSyncForClient', s4)
		toMasterLockB = ormB.getLock('transport:toMaster')
	})

	afterEach(async () => {
		await ormA('Model', 'db1').remove({}).direct()
		await ormA('Model', 'db2').remove({}).direct()
		await ormA('Commit', 'db1').remove({}).direct()
		await ormA('Commit', 'db2').remove({}).direct()
		let orms = [ormB, ormC, ormD, ormE]
		for (const orm of orms) {
			await orm('Model').remove({}).direct()
			await orm('Commit').remove({}).direct()
			await orm('Recovery').remove({}).direct()
		}
	})

	it('Case client to cloud as master', async (done) => {
		await toMasterLockB.acquireAsync()
		const doc = await ormB('Model').create({ table: 10 })
		const order = await ormB('Model').findOne({ _id: doc._id })
		const recoveries = await ormB('Recovery').find({})
		expect(stringify(order)).toMatchSnapshot()
		expect(stringify(recoveries)).toMatchSnapshot()
		await new Promise((resolve) => {
			ormA.onCount('update:Commit:c', function (count) {
				if (count === 1) {
					resolve()
				}
			})
			toMasterLockB.release()
		})
		await delay(50)
		const data = await ormA('Model', 'db1').findOne({ _id: doc._id })
		const dataFromD = await ormD('Model').findOne({ _id: doc._id })
		expect(stringify(dataFromD)).toMatchSnapshot()
		expect(stringify(data)).toMatchSnapshot()
		await ormD('Model').findOneAndUpdate({
			_id: doc._id
		}, {
			status: 'inProgress'
		})
		await delay(50)
		const dataFromB = await ormB('Model').findOne({ _id: doc._id })
		const dataFromD2 = await ormD('Model').findOne({ _id: doc._id })
		expect(stringify(dataFromB)).toMatchSnapshot()
		expect(dataFromB).toEqual(dataFromD2)
		done()
	}, 30000)

	it('Case cloud to client as master', async function (done) {
		let docE = await ormE('Model').create({ table: 9, items: [] })
		await delay(50)
		ormE.onCount('transport:require-sync', count => {
			console.log('Counting for transport:require-sync', count)
		})
		let docA = await ormA('Model', 'db2').findOne({ _id: docE._id })
		expect(stringify(docA)).toMatchSnapshot()
		let docC = await ormC('Model').findOne({ _id: docE._id })
		expect(stringify(docC)).toMatchSnapshot()
		docC = await ormC('Model').findOneAndUpdate({
			_id: docE._id
		}, {
			$push: {
				items: {
					name: 'fanta'
				}
			}
		})
		await delay(50)
		expect(stringify(docC)).toMatchSnapshot()
		docE = await ormE('Model').findOne({_id: docC._id})
		docA = await ormA('Model', 'db2').findOne({ _id: docC._id })
		expect(stringify(docE)).toEqual(stringify(docC))
		expect(stringify(docA)).toEqual(stringify((docC)))
		expect(docA.items[0]._id.toString()).toEqual(docC.items[0]._id.toString())
		done()
	})
})
