const {reactive, computed, watch, watchEffect} = require('@vue/runtime-core');

const counter = reactive({ num: 0 })
const a = computed(() => counter.num + 1);
watch(counter, function (value) {})
counter.num = 7
