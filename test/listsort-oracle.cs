// The reference for app/listsort.js: sorts lists with .NET's own List<T>.Sort(Comparison<T>)
// - the ArraySortHelper introsort the game's binary carries - and writes, per case, the input keys,
// the order they come out in, the number of comparisons and a hash of every pair compared, in order.
// test/listsort.mjs runs the port on the same keys and must match all three, so the port takes the same
// path through the algorithm, not just the same result.
//
//   dotnet run test/listsort-oracle.cs -- test/listsort-cases.json
//
// The keys are sorted with the game's ranking shape, higher first (b - a), and most cases are full
// of ties, which is where an unstable sort shows. The last cases are built against the sort
// (McIlroy's adversary) so that it runs out of depth and falls back to heapsort, the one path random
// lists never reach.
#:property JsonSerializerIsReflectionEnabledByDefault=true
using System.Text.Json;

var rng = new Random(1318);
var cases = new List<object>();
int[] sizes = [2, 3, 4, 5, 8, 15, 16, 17, 18, 20, 24, 31, 32, 33, 40, 50, 64, 65, 80, 100, 111, 128, 150, 200];
foreach (var n in sizes)
    foreach (var range in new[] { 2, 3, 6, n / 3 + 1 })
        for (var rep = 0; rep < 2; rep++)
            cases.Add(Run("random", Enumerable.Range(0, n).Select(_ => rng.Next(1, range + 1)).ToArray()));
// The adversary's keys are all different, so they reach heapsort without a tie. The last two cases
// keep them until heapsort starts (the comparison count there, 1246 and 2992, is where app/listsort.js
// enters it) and then compare quarter keys, so heapsort has to place equal entries too. Any switch
// point is a fair test - the two sorts make the same calls up to it or the trace says otherwise.
foreach (var (n, heapAt) in new[] { (100, 1246), (200, 2992) })
{
    var killer = Killer(n);
    cases.Add(Run("adversary", killer));
    cases.Add(Run("adversary, halved", killer.Select(k => k / 2).ToArray()));
    cases.Add(Run("adversary, quartered in heapsort", killer, heapAt));
}

File.WriteAllText(args[0], JsonSerializer.Serialize(new { runtime = $".NET {Environment.Version}", cases }));
Console.WriteLine($"{cases.Count} cases written to {args[0]} by .NET {Environment.Version}");

// After `quarterAfter` comparisons (if given) the keys are compared divided by 4.
static object Run(string kind, int[] keys, int? quarterAfter = null)
{
    var items = keys.Select((k, i) => new Item(i, k)).ToList();
    uint trace = 2166136261;
    var comparisons = 0;
    items.Sort((a, b) =>
    {
        comparisons++;
        trace = (trace ^ (uint)a.Index) * 16777619;
        trace = (trace ^ (uint)b.Index) * 16777619;
        return comparisons > quarterAfter ? b.Key / 4 - a.Key / 4 : b.Key - a.Key;
    });
    return new { kind, keys, quarterAfter, order = items.Select(x => x.Index).ToArray(), comparisons, trace };
}

// McIlroy, "A Killer Adversary for Quicksort" (1999): values are fixed only as the sort compares
// them, always so as to make its pivots bad. Returned as keys for the higher-first comparison.
static int[] Killer(int n)
{
    var val = Enumerable.Repeat(n, n).ToArray();
    int gas = n, solid = 0, candidate = 0;
    var items = Enumerable.Range(0, n).Select(i => new Item(i, 0)).ToList();
    items.Sort((a, b) =>
    {
        int x = a.Index, y = b.Index;
        if (val[x] == gas && val[y] == gas)
        {
            if (x == candidate) val[x] = solid++;
            else val[y] = solid++;
        }
        if (val[x] == gas) candidate = x;
        else if (val[y] == gas) candidate = y;
        return val[x] - val[y];
    });
    for (var i = 0; i < n; i++) if (val[i] == gas) val[i] = solid++;
    return val.Select(v => n - v).ToArray();
}

record Item(int Index, int Key);
