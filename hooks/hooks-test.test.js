const EE = require("./hooks");
let hooks;
let log;
const delay = require("delay");

describe("test hooks", function () {
  beforeEach(function () {
    hooks = new EE();
    log = jest.fn(function () {
      console.log(...arguments);
    });
  });

  it('default should called if don"t have pre or on', async function () {
    let arg;
    hooks.onDefault("test", async function () {
      log("default");
    });
    await hooks.emit("test", {arg}, e => eval(e));
    expect(log).toHaveBeenCalledWith("default");
  });

  it("normal on", async function () {
    hooks.on("test", async function ({arg}, e) {
      this.value = "11";
      //this.ok = true;
      log("on test");
    });
    await hooks.emit("test", {}, e => eval(e));
    expect(log).not.toHaveBeenCalledWith("default");
    expect(log).toHaveBeenCalledWith("on test");
  });

  it("normal on with pre", async function () {
    hooks.on("test", async function ({arg}, e) {
      this.value = "11";
      log("on test");
    });

    hooks.pre("test", async function () {
      log("pre");
    });

    await hooks.emit("test", {}, e => eval(e));
    expect(log).not.toHaveBeenCalledWith("default");
    expect(log).toHaveBeenCalledWith("on test");
    expect(log).toHaveBeenCalledWith("pre");
  });

  it("once", async function () {
    hooks.once("test", async function ({arg}, e) {
      log("on test");
    });

    hooks.pre("test", async function () {
      log("pre");
    });

    await hooks.emit("test", {}, e => eval(e));
    await hooks.emit("test", {}, e => eval(e));
    expect(log).not.toHaveBeenCalledWith("default");
    expect(log).toHaveBeenCalledWith("on test");
    expect(log).toHaveBeenCalledWith("pre");
  });

  it("sync", async function () {
    hooks.on("test", function () {
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

  it("test warning if arrow function", async function () {
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

  it("eval", async function () {
    let arg = 0;
    hooks.on("test", function ({arg}, e) {
      this.update("arg", 10);
    });

    hooks.emit("test", {arg}, e => eval(e));
    expect(arg).toMatchInlineSnapshot(`10`);
  });

  it("test default", async function () {
    const arr = [];
    hooks.onDefault("test", function () {
      arr.push("default");
    });

    hooks.on("test", function () {
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

  it("test onQueue", async function (done) {
    const arr = [];

    hooks.on("test", async function () {
      arr.push("a");
      await delay(2000);
      arr.push("b");
    });

    hooks.on("test2", async function () {
      arr.push("c");
      await delay(2000);
      arr.push("d");
      hooks.emit("done");
    });

    hooks.emit("test", e => eval(e));
    hooks.emit("test2", e => eval(e));

    hooks.on("done", () => {
      expect(arr).toMatchInlineSnapshot(`
        Array [
          "a",
          "c",
          "b",
          "d",
        ]
      `);
      done();
    });
  });

  it("test onQueue2", async function (done) {
    const arr = [];

    hooks.onQueue("test", "test", async function () {
      arr.push("a");
      await delay(2000);
      arr.push("b");
    });

    hooks.onQueue("test2", "test", async function () {
      arr.push("c");
      await delay(2000);
      arr.push("d");
      hooks.emit("done");
    });

    hooks.emit("test", e => eval(e));
    hooks.emit("test2", e => eval(e));

    hooks.on("done", () => {
      expect(arr).toMatchInlineSnapshot(`
        Array [
          "a",
          "b",
          "c",
          "d",
        ]
      `);
      done();
    });
  });

  it("serialize design", async function () {
    let _fn;
    let _scopes;
    let __eval;
    let arr = [];
    const emitStringify = function (e, cb, scopes, _eval) {
      const result = ([_fn, _scopes, __eval] = [cb.toString(), scopes, _eval]);
      for (const _var of scopes) {
        arr.push(_eval(_var));
      }
      return result;
    };

    function run() {
      let val = 10;
      emitStringify(
        "test",
        function () {
          console.log(val);
        },
        ["val"],
        e => eval(e)
      );
    }

    run();
    //const _fn = a.toString();
    const b = new Function(_scopes, `return (${_fn})()`)(...arr);
  });

  it("test onLayer", async function () {
    let arr = [];
    hooks.on("test", () => {
      arr.push(0);
    });

    let cb = () => {
      arr.push(-1);
    };

    hooks.on("test", -1, cb);

    hooks.off("test", cb);

    hooks.on("test", -1, cb);

    hooks.emit("test");
    expect(arr).toMatchInlineSnapshot(`
      Array [
        -1,
        0,
      ]
    `);
  });

  it("test stop", async function () {
    hooks.on("test", () => {
      console.log("0");
    });

    hooks.on("test", -1, function () {
      console.log("-1");
      this.stop();
    });

    hooks.emit("test");
  });

  it("test onCount", async function (done) {
    hooks.onCount("test", (count, arg) => {
      if (count === 2) done();
    });

    hooks.emit("test", 10);
    hooks.emit("test", 11);
  });

  it("test layer", async function () {
    let arr = [];
    hooks.on("test", 1, arg => {
      arr.push("3");
    });

    hooks.onQueue("test", arg => {
      arr.push("1");
    });

    hooks.on("test", arg => {
      arr.push("2");
    });

    hooks.emit("test");
    expect(arr).toMatchInlineSnapshot(`
      Array [
        "1",
        "2",
        "3",
      ]
    `);
  });

  it('test lock', async function (done) {
    hooks.onQueue('test', async function () {
      await delay(10);
      console.log('onQueue');
    })

    hooks.on('test', function () {
      console.log('on');
    })

    hooks.onQueueCount('test', async function (count) {
      console.log('onQueueCount : ', count);
      if (count === 2) done();
    })

    hooks.emit('test');
    hooks.emit('test');
  })

  it('test await emit', async function (done) {
    await hooks.emit('test');
  })

  it('test setValue', async function (done) {
    hooks.on('add', async function (arg) {
      await delay(1000);
      this.setValue(arg + 1)
    })
    const a = await hooks.emit('add', 10);
    done();
  })

  it('test off', async function () {
    hooks.on('test', function () {
      console.log('test');
    })

    hooks.off('test')
    hooks.emit('test');
  })

  it('test off from on' , function () {
    const {off} = hooks.on('test', function () {
      console.log('test');
    })
    off();
    hooks.emit('test');
  })

  it('test async and sync run at the same time', function () {
    let arr = [];
    hooks.on("test", () => {
      arr.push(0);
    });

    let cb = async () => {
      await new Promise(resolve => resolve(arr.push(-1)))
    };

    hooks.on("test", -1, cb);

    hooks.emit("test");
    expect(arr).toMatchInlineSnapshot(`
      Array [
        -1,
        0,
      ]
    `);
  })
});
