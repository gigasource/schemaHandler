const orm = require('../../../orm')
const { stringify } = require('../../../utils')
const FAKE_LAYER_TAG = require('../../../plugins/tags')

describe('Fake document test', () => {
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
  });

  const cb = async function (query) {
    query.mockCollection = true
    orm.once(`proxyPreReturnValue:${query.uuid}`, async function (_query, target, exec) {
      await orm.emit(`${FAKE_LAYER_TAG}:preFakeDocuments`, _query.name, target.parseCondition)
      this.value = await exec()
      await orm.emit(`${FAKE_LAYER_TAG}:postFakeDocuments}`, _query.name, target.parseCondition)
    })
  }

  it('Fake a create query', async () => {
    orm.on('pre:execChain', cb)

    const orderModel = orm("Order");
    const result = await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
    expect(stringify(result)).toMatchInlineSnapshot()
    orm.off('pre:execChain', cb)
  })

  it('Fake an exists doc', async () => {
    const orderModel = orm("Order");
    const orderModelRecovery = orm("Order-recovery")
    const doc = await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    })
    orm.on('pre:execChain', cb)
    const recoveryPreLen = (await orderModelRecovery.find()).length
    const result = await orderModel.findOneAndUpdate({ _id: doc._id}, { table: 20 })
    expect(stringify(result)).toMatchInlineSnapshot()
    const original = orderModelRecovery.findOne({ _id: doc._id })
    expect(stringify(original)).toMatchInlineSnapshot()
    await orm.emit(`${FAKE_LAYER_TAG}:recover`, { _id: doc._id })
    const recovered = await orderModel.findOne({ _id: doc._id })
    expect(stringify(recovered)).toMatchInlineSnapshot()
    const recoveryPostLength = (await orderModelRecovery.find()).length
    expect(recoveryPostLength).toBe(recoveryPreLen)
    orm.off('pre:execChain', cb)
  })
})
