import { describe, expect, it } from 'vitest';
import { buildChanges, mergeNearbyChanges } from './diff';
import {
  MergeConflictError,
  acceptedConflicts,
  applyAcceptedChanges,
  changesConflict,
  findConflicts,
} from './merge';
import { countWords } from './wordcount';
import type { IdentifiedChange, TextChange } from './types';

function identify(changes: TextChange[], idPrefix = 'c'): IdentifiedChange[] {
  return changes.map((change, index) => ({
    ...change,
    id: `${idPrefix}${index}`,
    seq: index,
    status: 'accepted',
  }));
}

describe('buildChanges', () => {
  it('把一次替换识别成 replace', () => {
    const changes = buildChanges('我有一只小猫。', '我有一只小狗。');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: 'replace',
      oldText: '猫',
      newText: '狗',
    });
    expect(changes[0]!.baseStart).toBe(5);
    expect(changes[0]!.baseEnd).toBe(6);
  });

  it('识别纯新增和纯删除', () => {
    const inserted = buildChanges('今天很好。', '今天真的很好。');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.type).toBe('insert');
    expect(inserted[0]!.newText).toBe('真的');
    expect(inserted[0]!.baseStart).toBe(inserted[0]!.baseEnd);

    const deleted = buildChanges('今天真的很好。', '今天很好。');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.type).toBe('delete');
    expect(deleted[0]!.oldText).toBe('真的');
  });

  it('没有修改时返回空列表', () => {
    expect(buildChanges('一样的文字', '一样的文字')).toEqual([]);
  });

  it('把距离很近的碎片合并成一条，方便孩子阅读', () => {
    const merged = mergeNearbyChanges(
      'abcdefghij',
      [
        { type: 'replace', baseStart: 2, baseEnd: 3, oldText: 'c', newText: 'C' },
        { type: 'replace', baseStart: 4, baseEnd: 5, oldText: 'e', newText: 'E' },
      ],
      2,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.oldText).toBe('cde');
    expect(merged[0]!.newText).toBe('CdE');
  });
});

describe('changesConflict', () => {
  const replaceA: TextChange = {
    type: 'replace',
    baseStart: 2,
    baseEnd: 5,
    oldText: 'abc',
    newText: 'x',
  };

  it('重叠的修改算冲突', () => {
    expect(
      changesConflict(replaceA, {
        type: 'replace',
        baseStart: 4,
        baseEnd: 7,
        oldText: 'def',
        newText: 'y',
      }),
    ).toBe(true);
  });

  it('相邻但不重叠的修改不算冲突', () => {
    expect(
      changesConflict(replaceA, {
        type: 'replace',
        baseStart: 5,
        baseEnd: 7,
        oldText: 'de',
        newText: 'y',
      }),
    ).toBe(false);
  });

  it('完全相同的修改不算冲突，合并时只应用一次', () => {
    expect(changesConflict(replaceA, { ...replaceA })).toBe(false);
  });

  it('插入落在被删除的区间内部时算冲突', () => {
    expect(
      changesConflict(replaceA, {
        type: 'insert',
        baseStart: 3,
        baseEnd: 3,
        oldText: '',
        newText: '！',
      }),
    ).toBe(true);
  });

  it('插入落在边界上不算冲突', () => {
    expect(
      changesConflict(replaceA, {
        type: 'insert',
        baseStart: 5,
        baseEnd: 5,
        oldText: '',
        newText: '！',
      }),
    ).toBe(false);
  });
});

describe('applyAcceptedChanges', () => {
  const base = '我的妈妈有一双温暖的手。';

  it('只应用被接受的修改', () => {
    const changes = identify(buildChanges(base, '我的妈妈有一双温暖而有力的手。'));
    changes[0]!.status = 'accepted';
    expect(applyAcceptedChanges(base, changes)).toBe('我的妈妈有一双温暖而有力的手。');
  });

  it('拒绝的修改不生效', () => {
    const changes = identify(buildChanges(base, '我的妈妈有一双温暖而有力的手。'));
    changes.forEach((change) => {
      change.status = 'rejected';
    });
    expect(applyAcceptedChanges(base, changes)).toBe(base);
  });

  it('两位审阅者做了完全相同的修改时只应用一次', () => {
    const dad = identify(buildChanges(base, '我的妈妈有一双温暖的手啊。'), 'dad');
    const mom = identify(buildChanges(base, '我的妈妈有一双温暖的手啊。'), 'mom');
    expect(applyAcceptedChanges(base, [...dad, ...mom])).toBe('我的妈妈有一双温暖的手啊。');
  });

  it('两条插入在同一位置时按顺序拼接', () => {
    const a: IdentifiedChange = {
      id: 'a',
      seq: 0,
      status: 'accepted',
      type: 'insert',
      baseStart: 3,
      baseEnd: 3,
      oldText: '',
      newText: 'A',
    };
    const b: IdentifiedChange = {
      id: 'b',
      seq: 1,
      status: 'accepted',
      type: 'insert',
      baseStart: 3,
      baseEnd: 3,
      oldText: '',
      newText: 'B',
    };
    expect(applyAcceptedChanges('012345', [b, a])).toBe('012AB345');
  });

  it('接受了两条互相重叠的修改时抛出冲突错误', () => {
    const baseText = 'abcdefgh';
    const a: IdentifiedChange = {
      id: 'a',
      seq: 0,
      status: 'accepted',
      type: 'replace',
      baseStart: 2,
      baseEnd: 5,
      oldText: 'cde',
      newText: 'X',
    };
    const b: IdentifiedChange = {
      id: 'b',
      seq: 1,
      status: 'accepted',
      type: 'replace',
      baseStart: 4,
      baseEnd: 6,
      oldText: 'ef',
      newText: 'Y',
    };
    expect(acceptedConflicts([a, b])).toHaveLength(1);
    expect(() => applyAcceptedChanges(baseText, [a, b])).toThrow(MergeConflictError);
  });
});

describe('findConflicts', () => {
  it('找出所有冲突对', () => {
    const changes: IdentifiedChange[] = [
      { id: '1', seq: 0, status: 'accepted', type: 'replace', baseStart: 0, baseEnd: 3, oldText: 'abc', newText: 'x' },
      { id: '2', seq: 1, status: 'accepted', type: 'replace', baseStart: 2, baseEnd: 5, oldText: 'cde', newText: 'y' },
      { id: '3', seq: 2, status: 'accepted', type: 'replace', baseStart: 10, baseEnd: 12, oldText: 'kl', newText: 'z' },
    ];
    const pairs = findConflicts(changes);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a.id).toBe('1');
    expect(pairs[0]!.b.id).toBe('2');
  });
});

describe('countWords', () => {
  it('统计汉字和标点', () => {
    const result = countWords('　　我爱我的妈妈。');
    expect(result.cjk).toBe(6);
    expect(result.chars).toBe(6);
    expect(result.charsWithPunctuation).toBe(7);
  });

  it('英文按单词统计', () => {
    const result = countWords('I love my mom.');
    expect(result.latinWords).toBe(4);
    expect(result.chars).toBe(4);
  });

  it('中英混排都算上', () => {
    const result = countWords('我用 iPad 写作文。');
    expect(result.cjk).toBe(5);
    expect(result.latinWords).toBe(1);
    expect(result.chars).toBe(6);
  });
});
