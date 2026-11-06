import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';

/**
 * A page is shown again from scratch when only its address parameter changes (/friends/a -> /friends/b). Angular would otherwise keep
 * the same page instance, and the conversation page reads its friend once, when it is made.
 */
export class ParamsRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot): boolean {
    return super.shouldReuseRoute(future, current) && JSON.stringify(future.params) === JSON.stringify(current.params);
  }
}
