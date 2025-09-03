const assert = require('assert');
const {registerCall, getE164, validateCountryCode} = require('../../lib/utils');
const { mergeEnvVarsWithDefaults } = require('@jambonz/node-client-ws');

const sessions = {};

const service = ({logger, makeService}) => {
  const svc = makeService({path: '/'});
  const schema = require('../../app.json');

  svc.on('session:new', async(session) => {
    const env = mergeEnvVarsWithDefaults(session.env_vars, svc.path, schema);
    const DEFAULT_COUNTRY = env.DEFAULT_COUNTRY || false;
    const OVERRIDE_FROM_USER = env.OVERRIDE_FROM_USER || false;
    sessions[session.call_sid] = session;
    session.locals = {logger: logger.child({call_sid: session.call_sid})};
    let {from, to, direction, call_sid} = session;
    logger.info(`new incoming call: ${session.call_sid}`);



    let outboundFromRetell = false;
    if (session.direction === 'inbound' &&
      env.PSTN_TRUNK_NAME && env.RETELL_SIP_CLIENT_USERNAME &&
      session.sip.headers['X-Authenticated-User']) {

      /* check if the call is coming from Retell; i.e. using the sip credential we provisioned there */
      const username = session.sip.headers['X-Authenticated-User'].split('@')[0];
      if (username === env.RETELL_SIP_CLIENT_USERNAME) {
        logger.info(`call ${session.call_sid} is coming from Retell`);
        outboundFromRetell = true;
      }
    }
    session
      .on('/refer', onRefer.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session))
      .on('/dialAction', onDialAction.bind(null, session))
      .on('/referComplete', onReferComplete.bind(null, session));

    try {
      let target;
      let headers = {}
      if (outboundFromRetell) {
        /* call is coming from Retell, so we will forward it to the original dialed number */
        target = [
          {
            type: 'phone',
            number: to,
            trunk: env.PSTN_TRUNK_NAME
          }
        ];
        /* Workaround for SIPGATE, put User ID as from and CLI in header */
        if (session.sip.headers['X-Original-CLID']) {
          // use the original CLID as the from number
          from = session.sip.headers['X-Original-CLID'];
        }
        else if (OVERRIDE_FROM_USER) {
          //headers["P-Preferred-Identity"] = `${from}@SIPGATE_DOMAIN`;
          from = OVERRIDE_FROM_USER;
        }
      }
      else {

        const dest = DEFAULT_COUNTRY ? await getE164(session.locals.logger, to, DEFAULT_COUNTRY) : to
        target = [
          {
            type: 'phone',
            number: dest,
            trunk: env.RETELL_TRUNK_NAME
          }
        ];
      }

      session
        .dial({
          callerId: from,
          answerOnBridge: true,
          anchorMedia: true,
          referHook: '/refer',
          actionHook: '/dialAction',
          target,
          headers
        })
        .hangup()
        .send();
    } catch (err) {
      session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
      session.close();
    }
  });
};

const onRefer = (session, evt) => {
  const {logger} = session.locals;
  const {refer_details} = evt;
  logger.info({refer_details}, `session ${session.call_sid} received refer`);

  session
    .sip_refer({
      referTo: refer_details.refer_to_user,
      referredBy: evt.to,
      actionHook: '/referComplete'

    })
    .reply();
};

const onClose = (session, code, reason) => {
  delete sessions[session.call_sid]
  const {logger} = session.locals;
  logger.info({code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.info({err}, `session ${session.call_sid} received error`);
};

const onDialAction = (session, evt) => {
  const {logger} = session.locals;
  if (evt.dial_call_status != 'completed') {
    logger.info(`outbound dial failed with ${evt.dial_call_status}, ${evt.dial_sip_status}`);
    session
      .sip_decline({status: evt.dial_sip_status})
      .reply();
  }
}

/* When the refer completes if we have an adulted call scenario hangup the original A leg */
const onReferComplete = (session, evt) => {
  const {logger} = session.locals;
  logger.info({evt}, 'referComplete');
  if (session.parent_call_sid) {
    logger.info(`Sending hangup to parent session ${session.parent_call_sid}`);
    const parentSession = sessions[session.parent_call_sid];
    parentSession
      .hangup()
      .send();
  } else {
    logger.info('No parent session');
  }
};

module.exports = service;
