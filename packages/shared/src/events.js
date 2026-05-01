const amqp = require('amqplib');

const createEnvelope = (event, data) => {
  return {
    event,
    timestamp: new Date().toISOString(),
    data
  };
};

const createEventBus = async (config, logger) => {
  try {
    const connection = await amqp.connect(config.rabbitmqUrl);
    const channel = await connection.createChannel();
    await channel.assertExchange(config.eventExchange, 'topic', { durable: true });

    return {
      connected: true,
      publish: async (event, data) => {
        const envelope = createEnvelope(event, data);
        channel.publish(
          config.eventExchange,
          event,
          Buffer.from(JSON.stringify(envelope)),
          { persistent: true, contentType: 'application/json' }
        );
        logger.info('Published event', { event });
        return envelope;
      },
      subscribe: async ({ queueName, events, onMessage }) => {
        await channel.assertQueue(queueName, { durable: true });
        for (const event of events) {
          await channel.bindQueue(queueName, config.eventExchange, event);
        }

        channel.consume(queueName, async (message) => {
          if (!message) {
            return;
          }

          try {
            const payload = JSON.parse(message.content.toString());
            await onMessage(payload);
            channel.ack(message);
          } catch (error) {
            logger.error('Failed to process message', {
              queueName,
              error: error.message
            });
            channel.nack(message, false, false);
          }
        });
      },
      close: async () => {
        await channel.close();
        await connection.close();
      }
    };
  } catch (error) {
    logger.warn('RabbitMQ unavailable, using no-op event bus', {
      error: error.message
    });

    return {
      connected: false,
      publish: async (event, data) => createEnvelope(event, data),
      subscribe: async () => undefined,
      close: async () => undefined
    };
  }
};

module.exports = {
  createEnvelope,
  createEventBus
};
