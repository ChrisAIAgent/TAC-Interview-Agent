import test from 'node:test';
import assert from 'node:assert/strict';
import { detectQuestion, normalizeQuestion, questionSimilarity } from '../src/renderer/src/session/questionDetect.ts';

test('only final questions at least six characters are accepted', () => {
  assert.equal(detectQuestion('请介绍一下你的项目经历', false).reason, 'partial');
  assert.equal(detectQuestion('为什么？', true).reason, 'too_short');
  assert.equal(detectQuestion('请介绍一下你的项目经历', true).isQuestion, true);
  assert.equal(detectQuestion('你负责了哪些项目？', true).isQuestion, true);
  assert.equal(detectQuestion('我负责后端系统开发', true).reason, 'no_question_marker');
});
test('confirmation prefixes are excluded', () => {
  for (const text of ['嗯请介绍一下项目','对请说说项目经历','好的请举例说明项目','行请谈谈项目经历']) assert.equal(detectQuestion(text, true).reason, 'confirmation');
});
test('normalization, bigram similarity and the five-item window', () => {
  assert.equal(normalizeQuestion(' 你好，ABC！'), '你好abc');
  assert.equal(questionSimilarity('请介绍一下项目经历？', '请介绍一下项目经历!'), 1);
  assert.equal(detectQuestion('请介绍一下项目经历？', true, ['请介绍一下项目经历!']).reason, 'duplicate');
  assert.equal(detectQuestion('请介绍一下项目经历？', true, ['请介绍一下项目经历!', '甲','乙','丙','丁','戊']).isQuestion, true);
  assert.equal(questionSimilarity('', ''), 0);
});
