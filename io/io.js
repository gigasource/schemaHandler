const EE = require('events');
const Hooks = require('../hooks/hooks');

const hooks = new Hooks();

class Socket extends Hooks {
  hooks = hooks
  connect(address, name) {
    let args
    if (address.includes('?')) {
      [address, args] = address.split('?')
    }
    this.address = address;
    const bindingSocket = this.bindingSocket = new BindingSocket();
    if (args) {
      args = args.split('&')
      args.forEach(arg => {
        const [val, key] = arg.split('=')
        bindingSocket[val] = key
      })
    }
    bindingSocket.name = name
    bindingSocket.address = address;
    bindingSocket.bindingSocket = this;
    hooks.emit(`connect:${address}`, bindingSocket);
  }

  _emit() {
    super.emit(...arguments);
  }

  emit(event, ...args) {
    this.bindingSocket && this.bindingSocket._emit(...arguments);
  }

  on(event, listener) {
    super.on(...arguments);
  }

  disconnect() {
    hooks.emit(`disconnect:${this.address}`, this.bindingSocket);
  }

  emitTo(target, event, ...args) {
    this.emit('emitToMock', target, event, ...args)
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
      const cb = function () {
        return socket.emit(...arguments);
      }
      socket.on('emitToMock', function (target, eventName, ...args) {
        _this.sockets.forEach((mapValue, _socket) => {
          if (_socket.clientId && _socket.clientId === target) {
            _socket.emit(eventName, ...args)
          }
        })
      })
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
