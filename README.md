# frida-remote-stream

Create an outbound stream over a message transport.

## Example

### Read from agent, write to host

In your agent.js:

```js
const fs = require('frida-fs');
const RemoteStreamController = require('frida-remote-stream');

const controller = new RemoteStreamController();
controller.events.on('send', packet => {
  send({
    name: '+stream',
    payload: packet.stanza
  }, packet.data);
});
function onStreamMessage(message, data) {
  controller.receive({ stanza: message.payload, data });

  recv('+stream', onStreamMessage);
}
recv('+stream', onStreamMessage);

fs.createReadStream('/very/large/file').pipe(controller.open('filedump', { meta: 'data' }));
```

In your application:

```js
const fs = require('fs');
const RemoteStreamController = require('frida-remote-stream');

const controller = new RemoteStreamController();
controller.events.on('send', packet => {
  script.post({
    type: '+stream',
    payload: packet.stanza
  }, packet.data);
});
script.message.connect((message, data) => {
  if (message.type === 'send') {
    const stanza = message.payload;
    switch (stanza.name) {
    case '+stream':
      controller.receive({ stanza: stanza.payload, data });
      break;
    }
  }
});

controller.events.on('stream', stream => {
  // stream.details.meta === 'data'

  stream.pipe(fs.createWriteStream('/tmp/interesting-file'));
});
```

### Read from host, write to agent

In your agent.js:

```js
const fs = require('frida-fs');
const RemoteStreamController = require('frida-remote-stream');

const streams = new RemoteStreamController();
streams.on('send', (stanza, data) => {
  send({
    name: '+stream',
    payload: stanza
  }, data ? data.buffer : null);
});
function onStreamMessage(message, data) {
  streams.receive(message.payload, data ? new Buffer(data) : null);

  recv('+stream', onStreamMessage);
}
recv('+stream', onStreamMessage);

streams.on('stream', stream => {
  stream.pipe(fs.createWriteStream('/very/large/file'));
});
```

In your application:

```js
const fs = require('fs');
const RemoteStreamController = require('frida-remote-stream');

const streams = new RemoteStreamController();
streams.on('send', (stanza, data) => {
  script.post({
    type: '+stream',
    payload: stanza
  }, data);
});
script.events.listen('message', (message, data) => {
  if (message.type === 'send') {
    const stanza = message.payload;
    switch (stanza.name) {
    case '+stream':
      streams.receive(stanza.payload, data);
      break;
    }
  }
});

fs.createReadStream('/tmp/interesting-file').pipe(streams.open('filedump', { meta: 'data' }));
```
