// List<T>.Sort(Comparison<T>) exactly as the game runs it, so entries a ranking's comparison
// calls equal come out in the order the game prints them.
//
// The sort is unstable - it promises no order for equal entries - but it is deterministic, and
// the game feeds it the run totals in an order the viewer rebuilds exactly. So porting it
// reproduces the game's order rather than guessing.
//
// It is the .NET Core ArraySortHelper<T> introsort. Every comparison test below is the one in the
// binary (< 0, > 0, >= 0): swapping one for another changes where equal entries end up. A
// partition of 4 to 16 goes to insertion sort, which keeps equal entries in input order, and one
// of 2 is swapped only when out of order. Equal entries move in a partition of exactly 3, sorted
// by three compare-and-swaps ([4, 4, 5], higher first, comes out 5, then the second 4, then the
// first), and when a list longer than 16 is partitioned.

/** A sorted copy of `items`, in the order the game's List.Sort leaves them. */
export function listSort(items, cmp) {
  const keys = items.slice();
  if (keys.length > 1) introSort(keys, 0, keys.length - 1, 2 * bitLength(keys.length), cmp);
  return keys;
}

function bitLength(n) {
  let bits = 0;
  do { n >>>= 1; bits++; } while (n);
  return bits;
}

function introSort(keys, lo, hi, depthLimit, cmp) {
  while (hi > lo) {
    const size = hi - lo + 1;
    if (size <= 16) {
      if (size === 2) {
        swapIfGreater(keys, cmp, lo, hi);
      } else if (size === 3) {
        swapIfGreater(keys, cmp, lo, hi - 1);
        swapIfGreater(keys, cmp, lo, hi);
        swapIfGreater(keys, cmp, hi - 1, hi);
      } else {
        insertionSort(keys, lo, hi, cmp);
      }
      return;
    }
    if (depthLimit === 0) {
      heapsort(keys, lo, hi, cmp);
      return;
    }
    depthLimit--;
    const p = pickPivotAndPartition(keys, lo, hi, cmp);
    introSort(keys, p + 1, hi, depthLimit, cmp);
    hi = p - 1;
  }
}

function swapIfGreater(keys, cmp, i, j) {
  if (i !== j && cmp(keys[i], keys[j]) > 0) swap(keys, i, j);
}

function swap(keys, i, j) {
  const t = keys[i];
  keys[i] = keys[j];
  keys[j] = t;
}

function insertionSort(keys, lo, hi, cmp) {
  for (let i = lo; i < hi; i++) {
    let j = i;
    const t = keys[i + 1];
    while (j >= lo && cmp(t, keys[j]) < 0) {
      keys[j + 1] = keys[j];
      j--;
    }
    keys[j + 1] = t;
  }
}

function pickPivotAndPartition(keys, lo, hi, cmp) {
  const middle = lo + ((hi - lo) >> 1);
  swapIfGreater(keys, cmp, lo, middle);
  swapIfGreater(keys, cmp, lo, hi);
  swapIfGreater(keys, cmp, middle, hi);
  const pivot = keys[middle];
  if (middle !== hi - 1) swap(keys, middle, hi - 1);
  let left = lo, right = hi - 1;
  while (left < right) {
    while (cmp(keys[++left], pivot) < 0);
    while (cmp(pivot, keys[--right]) < 0);
    if (left >= right) break;
    swap(keys, left, right);
  }
  if (left !== hi - 1) swap(keys, left, hi - 1);
  return left;
}

function heapsort(keys, lo, hi, cmp) {
  const n = hi - lo + 1;
  for (let i = n >> 1; i >= 1; i--) downHeap(keys, i, n, lo, cmp);
  for (let i = n; i > 1; i--) {
    swap(keys, lo, lo + i - 1);
    downHeap(keys, 1, i - 1, lo, cmp);
  }
}

function downHeap(keys, i, n, lo, cmp) {
  const d = keys[lo + i - 1];
  while (i <= n >> 1) {
    let child = 2 * i;
    if (child < n && cmp(keys[lo + child - 1], keys[lo + child]) < 0) child++;
    if (cmp(d, keys[lo + child - 1]) >= 0) break;
    keys[lo + i - 1] = keys[lo + child - 1];
    i = child;
  }
  keys[lo + i - 1] = d;
}
