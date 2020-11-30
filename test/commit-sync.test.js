const {
  checkEqual2,
  convertSchemaToPaths,
  findAllPathsInLevelArrHandler2,
  parseCondition
} = require("../schemaHandler");
const orm = require("../orm");
const { ObjectID } = require("bson");
const { stringify } = require("../utils");
const _ = require("lodash");
let id = () => "5fb7f13453d00d8aace1d89b";
let paths, Model, model, schema;
const uuid = require("uuid").v1;

describe("checkEqual", function() {
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    schema = {
      table: String
    };
  });

  it("case1", async function() {
    const Model = orm("Model");
    await Model.remove({});

    orm.post("pre:execChain", async function(query, returnResult) {
      query.uuid = uuid();
    });

    //replace with once later
    orm.post(
      "proxyResultPostProcess",
      async ({ target, result }, returnResult) => {
        if (target.collectionName === "Model") {
          const _id = result._id;
          if (target.query.commit) {
            const _result = await orm(target.collectionName).findOneAndUpdate(
              { _id },
              { $set: { _fake: true } }
            );
            returnResult.value = _result;
            returnResult.ok = true;
          }
        }
      }
    );

    orm.post("pre:execChain", async function(query, returnResult) {
      const last = _.last(query.chain);
      if (last.fn === "commit") {
        query.chain.pop();
        let _chain = [...query.chain];
        const { args } = last;
        const commit = {
          tags: args.filter(arg => typeof arg === "string"),
          data: _.assign({}, ...args.filter(arg => typeof arg === "object")),
          chain: JSON.stringify(_chain),
          _fake: true
        };

        const CommitCol = orm(`${query.name}Commit`);
        //commitId: incremental
        const _commit = await CommitCol.create(commit);
        await orm.execPostAsync(`commit:${query.name}`, null, [
          _commit,
          query,
          returnResult
        ]);
        //remove later:
        query.commit = true;

        //test behavior if not create model
      }
    });

    //Làm sao để assign duoc _id cho doc vua duoc tao ra
    //gen ra uuid cho mỗi câu lệnh query, từ đó hooks vào kết quả sau khi tạo ra
    //cần once : -> ko bị leak memory
    orm.post("commit:Model", async (commit, query, returnResult) => {
      //returnResult.ok = true;
      //returnResult.value = commit;
      //debugger
    });

    orm.post("//approve event", async () => {
      //sync data
      //remove fake
      //build model
      //do something custom
    });

    //order._fake = true;

    const m1 = await Model.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    }).commit("update", { table: "10" });
    //fake chi apply voi cac lenh apply cho one document

    debugger;
    //todo: save chain in db: use 1 collection ?? compound index?
    //todo: fake + approve process:
  });
});

// run when orm.create()
describe("Commit flow", function() {
  beforeAll(async () => {
    orm.connect({ uri: "mongodb://localhost:27017" }, "myproject");
    schema = {
      table: String
    };
    orm.commitHandler.registerCommitCollections("Order");
    orm.commitHandler.registerCommitCollections("Pos", ["Room", "OrderLayout"]);
    orm.commitHandler.startQueue();
  });

  it("check commitTypes array", () => {
    expect(orm.commitHandler.commitTypes).toMatchInlineSnapshot(`
      Object {
        "Order": "Order",
        "OrderLayout": "Pos",
        "Room": "Pos",
      }
    `);
  });

  it("check warn when a collection is added twice", () => {
    console.warn = jest.fn();
    orm.commitHandler.registerCommitCollections("someType", ["Room"]);
    expect(console.warn.mock.calls.length).toMatchInlineSnapshot(`1`);
  });

  it("create queue commit", async function(done) {
    orm.post("commit:preHandleCommits", commits => {
      expect(commits.length).toMatchInlineSnapshot();
    });
    orm.commitHandler.sync = jest.fn((commits, ack) => {
      ack(commits);
    });
    const commitHandlerFn = jest.fn(commit => {
      expect(typeof commit._id).toMatchInlineSnapshot(`"object"`);
      expect(commit._id.toString().length).toMatchInlineSnapshot(`24`);
      delete commit._id;
      expect(commit).toMatchInlineSnapshot(`
        Object {
          "collectionName": "Order",
          "query": "{\\"name\\":\\"Order\\",\\"chain\\":[{\\"fn\\":\\"create\\",\\"args\\":[{\\"table\\":10,\\"items\\":[{\\"name\\":\\"cola\\",\\"price\\":10,\\"quantity\\":1}]}]}]}",
        }
      `);
      expect(orm.commitHandler.sync.mock.calls.length).toMatchInlineSnapshot(
        `1`
      );
      expect(commitHandlerFn.mock.calls.length).toMatchInlineSnapshot(`1`);
      done();
    });
    orm.post("commit:Order", commitHandlerFn);
    const orderModel = orm("Order");
    await orderModel.create({
      table: 10,
      items: [{ name: "cola", price: 10, quantity: 1 }]
    });
  });
});