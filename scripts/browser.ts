/** Browser tests run locally on the Metal GPU; PW_GPU=swiftshader forces software GL. */
export function gpuArgs(): string[] {
  return process.env.PW_GPU === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
}
