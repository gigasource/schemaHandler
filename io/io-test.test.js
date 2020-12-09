const { Socket, Io } = require("./io");
const io = new Io();
const s1 = new Socket();

function init() {}

describe("test io", function() {
  beforeAll(() => {
    init();
  });

  it("case1", function(done) {
    io.listen("local");
    io.on("connect", socket => {
      socket.on("test", arg => {
        console.log(arg);
        done();
      });
      s1.emit("test", 10);
    });
    s1.connect("local");
  });

  it("case2", function(done) {
    io.listen("local");
    io.on("connect", socket => {
      s1.on("test", arg => {
        console.log(arg);
        done();
      });
      socket.emit("test", 10);
    });
    s1.connect("local");
  });

  it("case3", function(done) {
    io.listen("local");
    io.on("connect", socket => {
      s1.on("test", arg => {
        console.log(arg);
        done();
      });
      io.emit("test", 10);
    });
    s1.connect("local");
  });

  it("case4: disconnect", function(done) {
    io.listen("local");
    io.on("connect", socket => {
      console.log("connect");
    });
    io.on("disconnect", function(socket) {});
    s1.connect("local");
    s1.disconnect();
  });

  it("case5: disconnect", function(done) {
    io.listen("local");
    io.on("connect", socket => {
      socket.disconnect();
    });
    s1.on("disconnect", reason => {
      expect(reason).toMatchInlineSnapshot(`"io server disconnect"`);
      done();
      //'io server disconnect'
    });
    s1.connect("local");
  });

  it("case6: register clientId", function(done) {
    io.listen("local");
    io.on("connect", socket => {
      socket.on("test", arg => {
        console.log(arg);
        done();
      });
      s1.emit("test", 10);
    });
    s1.connect("local?clientId=s1");
  });


});
