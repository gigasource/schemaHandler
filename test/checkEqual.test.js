const { checkEqual2, filterMongoOperators2 } = require("../schemaHandler");
describe("checkEqual categories.0.products.0._id", function() {
  it("categories.products._id.test", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0._id".split("."),
      "categories.products._id.test".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`false`);
  });

  it("categories.products._id", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0._id".split("."),
      "categories.products._id".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`true`);
  });

  it("categories.1.products._id", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0._id".split("."),
      "categories.1.products._id".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`true`);
    expect(match).toMatchInlineSnapshot(`true`);
  });

  it("categories.1.products.items._id", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0.items.0._id".split("."),
      "categories.1.products.items._id".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`true`);
    expect(match).toMatchInlineSnapshot(`true`);
  });

  it("categories.1.products.items", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0.items.0._id".split("."),
      "categories.1.products.items".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`true`);
    expect(match).toMatchInlineSnapshot(`false`);
  });

  it("categories.products.items._id", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0.items.0._id".split("."),
      "categories.products.items._id".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`true`);
    expect(match).toMatchInlineSnapshot(`true`);
  });

  it("categories.products.items._id.$elemMatch.$in", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0.items.0._id".split("."),
      "categories.products.items._id.$elemMatch.$in".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`true`);
    expect(match).toMatchInlineSnapshot(`true`);
  });

  it("categories.products", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0".split("."),
      "categories.products".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`true`);
    expect(match).toMatchInlineSnapshot(`true`);
  });

  it("categories.products.1._id", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0".split("."),
      "categories.products.1._id".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`false`);
    expect(match).toMatchInlineSnapshot(`false`);
  });

  it("categories.products._id", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0".split("."),
      "categories.products._id".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`false`);
    expect(match).toMatchInlineSnapshot(`false`);
  });

  it("categories.products._id.$in.0", async function() {
    const { isEqual, relative, match } = checkEqual2(
      "categories.0.products.0._id".split("."),
      "categories.products._id.$in.0".split(".")
    );
    expect(isEqual).toMatchInlineSnapshot(`true`);
    expect(match).toMatchInlineSnapshot(`true`);
  });

  it("filterMongoOperators2: $and.0._id.$in.1", async function() {
    const arr = filterMongoOperators2("$and.0._id.$in.1".split("."));
    expect(arr).toMatchInlineSnapshot(`
      Array [
        "_id",
      ]
    `);
  });

  it("filterMongoOperators2: $and.0.categories.products.3._id.$elemMatch.$in.1", async function() {
    const arr = filterMongoOperators2(
      "$and.0.categories.products.3._id.$elemMatch.$in.1".split(".")
    );
    expect(arr).toMatchInlineSnapshot(`
      Array [
        "categories",
        "products",
        "3",
        "_id",
      ]
    `);
  });

  it("filterMongoOperators2: groups.$elemMatch.$in.1", async function() {
    const arr = filterMongoOperators2("groups.$elemMatch.$in.1".split("."));
    expect(arr).toMatchInlineSnapshot(`
      Array [
        "groups",
      ]
    `);
  });
});
