const TwitchChat = (() => {
  let client = null;
  let onMessageCb = () => {};
  let onStatusCb = () => {};

  function connect(channel) {
    if (client) {
      client.disconnect();
      client = null;
    }

    client = new tmi.Client({
      channels: [channel]
    });

    client.on('connected', () => onStatusCb(true));
    client.on('disconnected', () => onStatusCb(false));

    client.on('message', (chan, tags, message, self) => {
      if (self) return;
      onMessageCb({
        username: tags['display-name'] || tags.username,
        message: message.trim()
      });
    });

    return client.connect();
  }

  function disconnect() {
    if (client) {
      client.disconnect();
      client = null;
    }
  }

  function onMessage(cb) { onMessageCb = cb; }
  function onStatus(cb) { onStatusCb = cb; }

  return { connect, disconnect, onMessage, onStatus };
})();
