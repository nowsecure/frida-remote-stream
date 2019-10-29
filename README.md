# frida-remote-stream

Create an outbound stream over a message transport.

## Example

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
