const AwaitLock = require('await-lock').default

/**
 * Report includes:
 *  - Duplicate ID
 *  - Health check status
 *  - Commit status
 *  - Exception when run query of commit
 * @param orm
 */
const COMMIT_TYPE = {
	HEATH_CHECK: 'health-check',
	WRONG_COMMIT: 'wrong-commit',
	COMMIT_DATA: 'commit-data',
	ERROR_ID: 'error-id',
	EXEC_ERROR: 'exec-error'
}

const syncReport = function (orm) {
	let prevId
	const fnLock = new AwaitLock()

	setInterval(async () => {
		const commitData = await orm('CommitData').findOne()
		await orm('CommitReport').create({
			type: COMMIT_TYPE.COMMIT_DATA,
			commitData,
			date: new Date()
		})
		const clearDate = dayjs().subtract(7, 'day').toDate()
		await orm('CommitReport').deleteMany({
			type: COMMIT_TYPE.COMMIT_DATA,
			date: {
				'$lte': clearDate
			}
		})
	}, 60 * 1000 * 3)

	/**
	 * This must be called before lower id commits are deleted
	 */
	orm.on('commit:handler:finish', -1, async (commit) => {
		await fnLock.acquireAsync()
		if (!prevId) {
			const lastHighestIdCommit = (await orm('Commit').find({ id: { $lt: commit.id } }).sort({ id: -1 }).limit(1))
			if (!lastHighestIdCommit.length) {
				fnLock.release()
				return
			}
			prevId = lastHighestIdCommit[0].id
		}

		if (commit.prevId) {
			if (commit.prevId !== prevId) {
				await orm('CommitReport').create({
					type: COMMIT_TYPE.WRONG_COMMIT,
					wrongId: prevId,
					currentId: commit.id,
					prevId: commit.prevId
				})
			}
		} else {
			await orm('Commit').updateOne({id: commit.id}, { prevId })
		}
		prevId = commit.id
		fnLock.release()
	})
	/**
	 * Health check report
	 */
	orm.on('commit:report:health-check', async (name, status, date) => {
		const nearestReport = await orm('CommitReport').find({
			type: COMMIT_TYPE.HEATH_CHECK,
			name
		}).sort({ date: -1 }).limit(1)
		if (nearestReport.length && nearestReport[0].status === status)
			return
		await orm('CommitReport').create({
			type: COMMIT_TYPE.HEATH_CHECK,
			name,
			status,
			date
		})
	})
	/**
	 * Duplicate ID report
	 */
	orm.on('commit:report:getDuplicateID', async function () {
		this.value = await orm('Commit').aggregate([{ $group: { '_id': '$id', 'count': { $sum: 1 }} }, { $match: { 'count': { $gt: 1 } } }])
	})

	/**
	 * Commit id error
	 */
	orm.on('commit:report:errorId', async function (wrongId, realId) {
		await orm('CommitReport').create({
			type: COMMIT_TYPE.ERROR_ID,
			wrongId,
			realId,
			date: new Date()
		})
	})

	/**
	 * Commit execution error
	 */
	orm.on('commit:report:errorExec', async function (commitId, message) {
		await orm('CommitReport').create({
			type: COMMIT_TYPE.EXEC_ERROR,
			commitId,
			message,
			date: new Date()
		})
	})

	orm.on('commit:report:getReport', async function (dateTo) {
		const { value: duplicateId } = await orm.emit('commit:report:getDuplicateID')
		const healthCheckData = await orm('CommitReport').find({
			type: COMMIT_TYPE.HEATH_CHECK,
			...dateTo && {
				date: {
					$lte: dateTo
				}
			}
		}).sort({ date: -1 }).limit(300)
		const commitData = await orm('CommitReport').find({
			type: COMMIT_TYPE.COMMIT_DATA,
			...dateTo && {
				date: {
					$lte: dateTo
				}
			}
		}).sort({ date: -1 }).limit(600)
		commitData.push(await orm('CommitData').findOne())
		const wrongCommit = await orm('CommitReport').find({
			type: COMMIT_TYPE.WRONG_COMMIT
		})
		const execError = await orm('CommitReport').find({
			type: COMMIT_TYPE.EXEC_ERROR,
			...dateTo && {
				date: {
					$lte: dateTo
				}
			}
		}).sort({ date: -1 }).limit(100)

		this.value = {
			duplicateId,
			healthCheckData,
			commitData,
			wrongCommit,
			execError
		}
	})
}

module.exports = syncReport
