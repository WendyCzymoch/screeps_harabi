const heapStat = {
  total_heap_size: 551989248,
  total_heap_size_executable: 5767168,
  total_physical_size: 542299584,
  total_available_size: 202877848,
  used_heap_size: 421804048,
  heap_size_limit: 652562061,
  malloced_memory: 8192,
  peak_malloced_memory: 14283256,
  does_zap_garbage: 0,
  externally_allocated_size: 48959211,
}

console.log(heapStat.used_heap_size / heapStat.heap_size_limit)
