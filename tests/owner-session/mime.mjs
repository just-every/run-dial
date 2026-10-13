import {contract} from '../contract.mjs';
import assert from 'node:assert/strict';
import {mimeParts,receiptRawMime,assertAcknowledgementMime} from '../../scripts/owner-session/mime-proof.mjs';
const facts={title:'Discuss <tomorrow>',hostName:'Host & co'};
const text='Discuss <tomorrow> with Host & co. https://example.test/request';
const html='<table style="background:#176b5a"><tr><td>Dial Discuss &lt;tomorrow&gt; with Host &amp; co. <a href="https://example.test/request">Request</a></td></tr></table>';
function raw(h=html) {return `MIME-Version: 1.0\r\nContent-Type: multipart/alternative;\r\n boundary="test-boundary"\r\n\r\n--test-boundary\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(text).toString('base64')}\r\n--test-boundary\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${h.replace(/=/g,'=3D')}\r\n--test-boundary--\r\n`;}
contract('REQUEST-005', 'received raw MIME proves both decoded parts, escaped facts, links and inline Dial table layout',()=>{
 assert.equal(mimeParts(raw()).length,2);assert.deepEqual(assertAcknowledgementMime(raw(),facts),{parts:['text/plain','text/html'],tableLayout:true,inlineStyles:true,remoteResources:0,linksChecked:1});
 for(const changed of [html.replace('Host &amp; co','Other host'),html.replace('https://example.test/request','https://other.test'),html+'<img src="https://tracking.test/pixel">',html.replaceAll('table','div')])assert.throws(()=>assertAcknowledgementMime(raw(changed),facts));
 assert.throws(()=>mimeParts(raw().replace('--test-boundary--','')));
 assert.throws(()=>assertAcknowledgementMime('Content-Type: text/plain\r\n\r\n'+text,facts));
});
contract('REQUEST-005', 'inline MIME resolution refuses excerpts and ambiguous content; URLs require separate retrieval',()=>{
 assert.equal(receiptRawMime({rawMime:raw()}),raw());
 assert.equal(receiptRawMime({raw:raw(),rawContent:raw()}),raw());
 assert.throws(()=>receiptRawMime({excerpt:text,rawUrl:'https://example.test'}),/unavailable/);
 assert.throws(()=>receiptRawMime({rawMime:raw(),raw:'different'}),/ambiguous/);
});
