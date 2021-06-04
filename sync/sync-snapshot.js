const syncSnapshot = function (orm, collection) {
	orm.on(`process:commit:${collection}`, () => {
		if (collection) {

		}
	})

	const startSnapshot = async function () {
		orm.emit('block-sync', collection)
		const currentHighestId = (await orm('Commit').find().sort({ id: -1 }).limit(1)).id
		await orm('Commit').deleteMany({ collectionName: collection })
		await orm(collection).update({}, { snapshot: true })
		while (true) {
			const doc = await orm(collection).findOne({ snapshot: true })
			delete doc.snapshot
			await orm(collection).delete({ _id: doc._id }).direct()
			await orm(collection).create(doc)
		}
		orm.emit('unblock-sync', collection)
		orm.emit('snapshot-done')
	}
}

module.exports = syncSnapshot
