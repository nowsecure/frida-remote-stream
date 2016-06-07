'use strict';

const EventEmitter = require('events');
const stream = require('stream');

class Source extends stream.Readable {
  constructor(controller, endpoint) {
    super();

    this.label = endpoint.label;
    this.details = endpoint.details;
    this._controller = controller;
    this._endpoint = endpoint;

    this._onReadComplete = null;
    this._delivery = null;
  }

  _read(size) {
    if (this._onReadComplete !== null)
      return;

    this._onReadComplete = chunk => {
      this._onReadComplete = null;

      if (chunk.length === 0) {
        this.push(null);
        return false;
      }

      if (this.push(chunk))
        this._read(size);
      return true;
    };
    this._tryComplete();
  }

  _deliver(chunk) {
    return new Promise((resolve, reject) => {
      if (this._delivery !== null)
        throw new Error('Protocol violation');

      this._delivery = {
        chunk: chunk,
        resolve: resolve,
        reject: reject
      };
      this._tryComplete();
    });
  }

  _tryComplete() {
    const onReadComplete = this._onReadComplete;
    const delivery = this._delivery;
    if (onReadComplete === null || delivery === null)
      return;

    this._onReadComplete = null;
    this._delivery = null;

    if (onReadComplete(delivery.chunk))
      delivery.resolve();
    else
      delivery.reject(new Error('Stream closed'));
  }
}

class Sink extends stream.Writable {
  constructor(controller, endpoint) {
    super();

    this._controller = controller;
    this._endpoint = endpoint;

    this.once('finish', this._onFinish.bind(this));
  }

  _write(chunk, encoding, callback) {
    this._controller._request('.write', { endpoint: this._endpoint }, chunk)
    .then(_ => callback())
    .catch(error => callback(error));
  }

  _onFinish() {
    this._controller._request('.finish', { endpoint: this._endpoint }, null);
  }
}

class Controller extends EventEmitter {
  constructor(script) {
    super();

    this._handlers = {
      '.finish': this._onFinish.bind(this),
      '.write': this._onWrite.bind(this)
    };

    this._sources = {};
    this._nextEndpointId = 1;

    this._requests = {};
    this._nextRequestId = 1;
  }

  open(label, details) {
    const endpoint = {
      id: this._nextEndpointId++,
      label: label,
      details: details || {}
    };
    return new Sink(this, endpoint);
  }

  receive(stanza, data) {
    const id = stanza.id;
    const name = stanza.name;
    const type = name[0];
    const payload = stanza.payload;

    if (type === '.')
      this._onRequest(id, name, payload, data);
    else if (type === '+')
      this._onNotification(id, name, payload);
    else
      throw new Error('Unknown stanza: ' + name);
  }

  _onFinish(payload) {
    const id = payload.endpoint.id;
    const source = this._sources[id];
    delete this._sources[id];
    source.push(null);
  }

  _onWrite(payload, data) {
    const endpoint = payload.endpoint;
    const id = endpoint.id;

    let source = this._sources[id];
    if (source === undefined) {
      source = new Source(this, endpoint);
      this._sources[id] = source;
      this.emit('stream', source);
    }

    return source._deliver(data);
  }

  _request(name, payload, data) {
    return new Promise((resolve, reject) => {
      const id = this._nextRequestId++;

      this._requests[id] = {
        resolve: resolve,
        reject: reject
      };

      const stanza = {
        id: id,
        name: name,
        payload: payload
      };
      this.emit('send', stanza, data);
    });
  }

  _onRequest(id, name, payload, data) {
    const handler = this._handlers[name];
    if (handler === undefined)
      throw new Error('Unknown request: ' + name);

    let result;
    try {
      result = handler(payload, data);
    } catch (e) {
      this._reject(id, e);
      return;
    }

    if (result instanceof Promise) {
      result
      .then(value => this._resolve(id, value))
      .catch(error => this._reject(id, error))
    } else {
      this._resolve(id, result);
    }
  }

  _resolve(id, value) {
    this.emit('send', {
      id: id,
      name: '+result',
      payload: value
    }, null);
  }

  _reject(id, error) {
    this.emit('send', {
      id: id,
      name: '+error',
      payload: error.toString()
    }, null);
  }

  _onNotification(id, name, payload) {
    const request = this._requests[id];
    delete this._requests[id];

    if (name === '+result')
      request.resolve(payload);
    else if (name === '+error')
      request.reject(new Error(payload));
    else
      throw new Error('Unknown notification: ' + name);
  }
}

module.exports = Controller;
