import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pagesBase} from './pages-base.mjs';

test('upstream default, project paths and root sites',()=>{
  const old=process.env.PAGES_BASE_PATH;
  try{
    delete process.env.PAGES_BASE_PATH;
    assert.equal(pagesBase(),'/sd-ai/');
    assert.equal(pagesBase('/sd-ai'),'/sd-ai/');
    assert.equal(pagesBase('/buffalo-01'),'/buffalo-01/');
    assert.equal(pagesBase('/buffalo-01/'),'/buffalo-01/');
    assert.equal(pagesBase(''),'/');
    assert.equal(pagesBase('/'),'/');
    process.env.PAGES_BASE_PATH='/fork';
    assert.equal(pagesBase(),'/fork/');
  }finally{
    if(old===undefined)delete process.env.PAGES_BASE_PATH;
    else process.env.PAGES_BASE_PATH=old;
  }
});
test('reject invalid or ambiguous base paths',()=>{
  for(const path of ['sd-ai','//host','https://host','/../','/./','/a/b','/a?b','/a#b'])assert.throws(()=>pagesBase(path));
});
