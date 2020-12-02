const EE = require("./hooks");
let hooks;
let log;

describe("test hooks", function() {
  beforeEach(function() {
    hooks = new EE();
    log = jest.fn(function() {
      console.log(...arguments);
    });
  });

  it('default should called if don"t have pre or on', async function() {
    let arg;
    hooks.onDefault("test", async function() {
      log("default");
    });
    await hooks.emit("test", { arg }, e => eval(e));
    expect(log).toHaveBeenCalledWith("default");
  });

  it("normal on", async function() {
    hooks.on("test", async function({ arg }, e) {
      this.value = "11";
      //this.ok = true;
      log("on test");
    });
    await hooks.emit("test", {}, e => eval(e));
    expect(log).not.toHaveBeenCalledWith("default");
    expect(log).toHaveBeenCalledWith("on test");
  });

  it("normal on with pre", async function() {
    hooks.on("test", async function({ arg }, e) {
      this.value = "11";
      log("on test");
    });

    hooks.pre("test", async function() {
      log("pre");
    });

    await hooks.emit("test", {}, e => eval(e));
    expect(log).not.toHaveBeenCalledWith("default");
    expect(log).toHaveBeenCalledWith("on test");
    expect(log).toHaveBeenCalledWith("pre");
  });

  it("once", async function() {
    hooks.once("test", async function({ arg }, e) {
      log("on test");
    });

    hooks.pre("test", async function() {
      log("pre");
    });

    await hooks.emit("test", {}, e => eval(e));
    await hooks.emit("test", {}, e => eval(e));
    expect(log).not.toHaveBeenCalledWith("default");
    expect(log).toHaveBeenCalledWith("on test");
    expect(log).toHaveBeenCalledWith("pre");
  });

  it("sync", async function() {
    hooks.on("test", function() {
      this.ok = true;
      log("on test");
    });

    const r = hooks.emit("test", {}, e => eval(e));
    expect(r).toMatchInlineSnapshot(`
      Object {
        "ok": true,
        "update": [Function],
      }
    `);
  });

  it("test warning if arrow function", async function() {
    try {
      hooks.on("test", () => {
        this.ok = true;
        log("on test");
      });
    } catch (e) {
      expect(e.message).toMatchInlineSnapshot(
        `"don't use arrow function here because of scope"`
      );
    }
  });

  it("eval", async function() {
    let arg = 0;
    hooks.on("test", function({ arg }, e) {
      this.update("arg", 10);
    });

    hooks.emit("test", { arg }, e => eval(e));
    expect(arg).toMatchInlineSnapshot(`10`);
  });

  it("test default", async function() {
    const arr = [];
    hooks.onDefault("test", function() {
      arr.push("default");
    });

    hooks.on("test", function() {
      arr.push("test");
      hooks.emitDefault("test", ...arguments);
    });

    hooks.emit("test", {}, e => eval(e));
    expect(arr).toMatchInlineSnapshot(`
      Array [
        "test",
        "default",
      ]
    `);
  });
});
