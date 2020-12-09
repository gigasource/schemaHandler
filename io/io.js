const EE = require('events');
const Hooks = require('../hooks/hooks');

const hooks = new Hooks();

class Socket extends EE {
  hooks = hooks
  connect(address) {
    this.address = address;
    const bindingSocket = this.bindingSocket = new BindingSocket();
    bindingSocket.address = address;
    bindingSocket.bindingSocket = this;
    hooks.emit(`connect:${address}`, bindingSocket);
  }

  _emit() {
    super.emit(...arguments);
  }

  emit(event, ...args) {
    this.bindingSocket._emit(...arguments);
  }

  on(event, listener) {
    super.on(...arguments);
  }

  disconnect() {
    hooks.emit(`disconnect:${this.address}`, this.bindingSocket);
  }
}

class BindingSocket extends Socket {
  disconnect() {
    hooks.emit(`disconnect:server:${this.address}`, this);
  }
}

class Io extends Socket {
  sockets = new Map();
  listen(address) {
    this.address = address;
    const _this = this;

    hooks.on(`connect:${address}`, function (socket) {
      const mapValue = {}
      _this.sockets.set(socket, mapValue);
      const cb = () => socket.emit(...arguments)
      hooks.on(`emit:${address}`, cb);
      mapValue.off = function () {
        hooks.off(`emit:${address}`, cb);
      }
      _this._emit('connect', socket);
    });

    hooks.on(`disconnect:${address}`, function (socket) {
      const val = _this.sockets.get(socket);
      val.off();
      _this.sockets.delete(socket);
      _this._emit('disconnect', socket)
    });

    hooks.on(`disconnect:server:${address}`, function (socket) {
      socket.emit('disconnect', 'io server disconnect')
      hooks.emit(`disconnect:${address}`, socket);
    });


  }

  emit(event, ...args) {
    hooks.emit(`emit:${this.address}`, event, ...args);
  }
}


module.exports = {Socket, Io, hooks};
