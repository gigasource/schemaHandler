const syncSnapshot = function (orm, collection) {
	orm.on(`commit:handler:shouldNotExecCommand:${collection}`, async function (commit) {
		if (orm.isMaster() || !commit.data.snapshot) {
			return this.mergeValueAnd(false)
		}
		const currentHighestUUID = commit.data.currentHighestUUID

		// client only has highest id commit
		const highestCommit = await cms.getModel('Commit').findOne()
		if (highestCommit.uuid === currentHighestUUID)
			return this.mergeValueAnd(false)
		this.mergeValueAnd(true)
	})

	const startSnapshot = async function () {
		if (!orm.isMaster()) return
		orm.emit('block-sync', collection)
		const currentHighestUUID = (await orm('Commit').find().sort({ id: -1 }).limit(1)).uuid
		await orm('Commit').deleteMany({ collectionName: collection })
		await orm(collection).update({}, { snapshot: true }).direct()
		while (true) {
			const doc = await orm(collection).findOne({ snapshot: true })
			if (!doc)
				break
			delete doc.snapshot
			await orm(collection).deleteOne({ _id: doc._id }).commit({ currentHighestUUID, snapshot: true })
			await orm(collection).create(doc).commit({ currentHighestUUID, snapshot: true })
		}
		orm.emit('unblock-sync', collection)
		orm.emit('snapshot-done')
	}

	return {
		startSnapshot
	}
}

module.exports = syncSnapshot
