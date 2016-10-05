# frida-remote-stream

Create an outbound stream over a message transport.

## Example

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
function onStreamMessage(message) {
  streams.receive(message.payload, null);

  recv('+stream', onStreamMessage);
}
recv('+stream', onStreamMessage);

fs.createReadStream('/very/large/file').pipe(streams.open('filedump', { meta: 'data' }));
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

streams.on('stream', stream => {
  // stream.details.meta === 'data'

  stream.pipe(fs.createWriteStream('/tmp/interesting-file'));
});
```
