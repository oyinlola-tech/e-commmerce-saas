/* global jest */
const {
  normalizeAsyncFailureLimit,
  buildEventContextItems
} = require('../apps/services/notification-service/src/async-operations');

jest.mock('../apps/services/notification-service/src/template-renderer', () => ({
  renderEmailTemplate: jest.fn()
}));

const {
  buildOperatorReplayMetadata,
  requeueOutboundEmail
} = require('../apps/services/notification-service/src/outbound-email');

describe('async operations helpers', () => {
  test('caps the async failure limit to a safe UI range', () => {
    expect(normalizeAsyncFailureLimit()).toBe(25);
    expect(normalizeAsyncFailureLimit(2)).toBe(2);
    expect(normalizeAsyncFailureLimit(500)).toBe(50);
  });

  test('extracts high-signal event context fields for operators', () => {
    expect(buildEventContextItems({
      data: {
        store_id: 18,
        order_id: 77,
        reference: 'pay_123'
      }
    })).toEqual([
      'Store: 18',
      'Order: 77',
      'Reference: pay_123'
    ]);
  });

  test('records operator replay metadata without losing prior counts', () => {
    const result = buildOperatorReplayMetadata({
      kind: 'order_confirmation',
      operator_replay: {
        replay_count: 2
      }
    }, {
      userId: '42',
      actorRole: 'platform_owner'
    });

    expect(result.kind).toBe('order_confirmation');
    expect(result.operator_replay.replay_count).toBe(3);
    expect(result.operator_replay.last_replayed_by).toBe('42');
    expect(result.operator_replay.last_replayed_role).toBe('platform_owner');
    expect(result.operator_replay.last_replayed_at).toBeTruthy();
  });

  test('requeues a dead-lettered outbound email for normal worker processing', async () => {
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 91,
          status: 'dead_lettered',
          metadata: JSON.stringify({
            template_key: 'store.order_confirmation',
            operator_replay: {
              replay_count: 1
            }
          })
        }])
        .mockResolvedValueOnce([{
          id: 91,
          status: 'queued',
          metadata: JSON.stringify({
            template_key: 'store.order_confirmation',
            operator_replay: {
              replay_count: 2,
              last_replayed_by: '7',
              last_replayed_role: 'support_agent'
            }
          })
        }]),
      execute: jest.fn().mockResolvedValue({ affectedRows: 1 })
    };

    const email = await requeueOutboundEmail({
      db,
      emailId: 91,
      actor: {
        userId: '7',
        actorRole: 'support_agent'
      }
    });

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain("SET status = 'queued'");
    expect(email.status).toBe('queued');
  });

  test('blocks replay attempts for outbound emails that are no longer failed', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([{
        id: 12,
        status: 'sent',
        metadata: null
      }]),
      execute: jest.fn()
    };

    await expect(requeueOutboundEmail({
      db,
      emailId: 12,
      actor: {
        userId: '1',
        actorRole: 'platform_owner'
      }
    })).rejects.toMatchObject({
      status: 409
    });
  });
});
