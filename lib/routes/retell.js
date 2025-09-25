const assert = require('assert');
const {registerCall, getE164, validateCountryCode} = require('../../lib/utils');
const { mergeEnvVarsWithDefaults } = require('@jambonz/node-client-ws');

const sessions = {};

const service = ({logger, makeService}) => {
  const svc = makeService({path: '/'});
  const schema = require('../../app.json');

  svc.on('session:new', async(session) => {
    session.env = mergeEnvVarsWithDefaults(session.env_vars, svc.path, schema);
    const DEFAULT_COUNTRY = session.env.DEFAULT_COUNTRY || false;
    const OVERRIDE_FROM_USER = session.env.OVERRIDE_FROM_USER || false;
    
    sessions[session.call_sid] = session;
    session.locals = {logger: logger.child({call_sid: session.call_sid})};
    let {from, to, direction, call_sid} = session;
    logger.info(`new incoming call: ${session.call_sid}`);

    let outboundFromRetell = false;
    if (session.direction === 'inbound' &&
      session.env.PSTN_TRUNK_NAME && session.env.RETELL_SIP_CLIENT_USERNAME &&
      session.sip.headers['X-Authenticated-User']) {

      /* check if the call is coming from Retell; i.e. using the sip credential we provisioned there */
      const username = session.sip.headers['X-Authenticated-User'].split('@')[0];
      if (username === session.env.RETELL_SIP_CLIENT_USERNAME) {
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
      let headers = {};
      if (outboundFromRetell) {
          /* call is coming from Retell, so we will forward it to the original dialed number unless overide headers are sent*/
        headers = Object.fromEntries(
          Object.entries(session.sip.headers).filter(([key]) => key.startsWith('X-'))
        );
        target = [
          {
            type: 'phone',
            number: session.sip.headers['X-Override-Number'] ? session.sip.headers['X-Override-Number'] : to,
            trunk: session.sip.headers['X-Override-Carrier'] ? session.sip.headers['X-Override-Carrier'] : session.env.PSTN_TRUNK_NAME
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
        // if call was originated via Jambonz API then direction is outbound but then dial to retell, then we need to  reverse to/from
        const pstn_inbound = (session.direction == 'inbound') 
        const dest = DEFAULT_COUNTRY ? await getE164(session.locals.logger, to, DEFAULT_COUNTRY) : to
        target = [
          {
            type: 'phone',
            number: pstn_inbound ? dest : from,
            trunk: session.env.RETELL_TRUNK_NAME
          }
        ];
        from = pstn_inbound ? from : dest
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
  const PASS_REFER = session.env.PASS_REFER !== undefined ? session.env.PASS_REFER : true;
  logger.info({refer_details}, `session ${session.call_sid} received refer`);

  if (PASS_REFER){
    session
      .sip_refer({
        referTo: refer_details.refer_to_user,
        referredBy: evt.to,
        actionHook: '/referComplete'

      })
      .reply();
      logger.info(`session ${session.call_sid} refer sent to originator`);
  } else {
    target = [
          {
            type: 'phone',
            number: refer_details.x_override_number ? refer_details.x_override_number : refer_details.refer_to_user,
            trunk: refer_details.x_override_carrier ? refer_details.x_override_carrier : session.env.PSTN_TRUNK_NAME
          }
        ];
    session
        .say({text: "Connecting you"})
        .dial({
          callerId: evt.to,
          anchorMedia: true,
          actionHook: '/dialAction',
          target
        })
        .hangup()
        .reply();
        logger.info({target}, `session ${session.call_sid} new outbound dial intiated`);
  }
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
    logger.error(`outbound dial failed with ${evt.dial_call_status}, ${evt.dial_sip_status}`);
    session
      .sip_decline({status: evt.dial_sip_status})
      .reply();
  } else {
    logger.info(`dial completed`);
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
