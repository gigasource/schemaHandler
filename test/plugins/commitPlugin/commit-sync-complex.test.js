const orm = require("../../../orm");
const {ObjectID} = require("bson");
const {stringify} = require("../../../utils");
const _ = require('lodash');
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require('uuid').v1;
const TRANSPORT_LAYER_TAG = require('../../../plugins/commitPlugin/transporter').TAG

describe("commit-sync-complex", function () {
	beforeAll(async () => {
		orm.connect({uri: "mongodb://localhost:27017"}, 'myproject')
	})

	it('start master single db', async (done) => {
		orm.commitHandler.setMaster(true)
		http = require('http')
		const socketIO = require('socket.io')
		const httpServer = http.createServer((req, res) => res.end()).listen(9000)
		const server = socketIO.listen(httpServer, {})
		await orm.emit(`${TRANSPORT_LAYER_TAG}:registerClientSocket`, (_clientSocket, dbName) => {

		})
	})
})
