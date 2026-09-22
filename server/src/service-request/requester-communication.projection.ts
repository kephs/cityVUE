/**
 * Projection only, deliberately not an HTTP access boundary. A future caller must
 * independently authorize requester access to the parent before returning it.
 * Recording correspondence does not establish delivery or a read receipt.
 */
export function requesterCommunicationProjection(message: {
  id: string;
  body: string;
  createdAt: string;
  direction: 'outbound';
  channel: 'portal';
  deliveryState: 'recorded';
}) {
  return {
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    direction: message.direction,
    channel: message.channel,
    deliveryState: message.deliveryState,
    sender: { displayName: 'Service team' },
  };
}
