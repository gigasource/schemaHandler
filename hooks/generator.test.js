const EE = require("./hooks");
let hooks;
let log;
const {cloneableGenerator} = require('@wmakeev/cloneable-generator');


describe("test hooks", function () {
  beforeEach(function () {
    hooks = new EE();
    log = jest.fn(function () {
      console.log(...arguments);
    });
  });

  /*
    1. use generator for first time init
    2. use generator for callback hell
    3. use generator for complex flow
   */

  //problem is side effect !!!
  it('case 1', async function (done) {
    let cmd;

    function init() {

    }

    function cb() {
      cmd = 'cb';
    }

    function callbackWrapper() {
      return function (arg) {
        const fn = run();
        fn.next();
        fn.next('query');
      }
    }

    function end() {
      return true;
    }

    function custom() {
    }

    function buildFake() {
      console.log('build fake');
    }

    //simulate flow in generator function for better debug;
    function* run() {
      //use yield for init (one time to prevent side effect)
      cb();
      let query = yield () => hooks.on('pre:execChain', callbackWrapper());
      if (end()) {
        console.log('log here: ', query);
        custom('fake');
        yield () => buildFake();

        custom('toMaster');
        yield () => toMaster();
      }

      init()
      yield () => hooks.on('commit:remove-fake', callbackWrapper());
    }

    const descriptors = ['@callback']


    const fn = run();
    const step1 = fn.next().value;
    if (cmd === 'cb') {
      step1();
    }
    hooks.emit('pre:execChain', 'query');

    debugger
  });
});
