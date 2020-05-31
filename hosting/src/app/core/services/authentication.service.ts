import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/auth';
import { AngularFirestore, DocumentSnapshot } from '@angular/fire/firestore';
import { auth, User as fireUser } from 'firebase/app';

import { BehaviorSubject, from, Observable, of } from 'rxjs';
import { map, mergeMap, take, tap } from 'rxjs/operators';

import { User } from '../models';

@Injectable({
    providedIn: 'root',
})
export class AuthenticationService {

    public user: BehaviorSubject<User> = new BehaviorSubject<User>(null);

    constructor(
        private router: Router,
        private angularFireAuth: AngularFireAuth,
        private angularFirestore: AngularFirestore,
    ) { }

    public login(provider: 'google' | 'twitter' | 'facebook' | 'github'): void {
        let provision;

        switch (provider) {
            case 'google':
                provision = new auth.GoogleAuthProvider();
                break;
            case 'twitter':
                provision = new auth.TwitterAuthProvider();
                break;
            case 'facebook':
                provision = new auth.FacebookAuthProvider();
                break;
            case 'github':
                provision = new auth.GithubAuthProvider();
                break;
        }

        this.angularFireAuth.auth.signInWithRedirect(provision);
    }

    public signIn(email: string, password: string): Observable<void> {
        return from(this.angularFireAuth.auth.signInWithEmailAndPassword(email, password))
            .pipe(
                map((credentials) => credentials.user),
                map((user: fireUser) => this.convertToUser(user)),
                tap(() => this.router.navigate([ '/' ])),
                map((account) => this.user.next(account)),
            );
    }

    public register(displayName: string, email: string, password: string): Observable<User> {
        return from(this.angularFireAuth.auth.createUserWithEmailAndPassword(email, password))
            .pipe(
                map((credentials) => credentials.user),
                mergeMap((user: fireUser) => from(user.updateProfile({ displayName })).pipe(map(() => user))),
                mergeMap((user: fireUser) => this.sendVerification().pipe(map(() => user))),
                map((user: fireUser) => this.convertToUser(user)),
                mergeMap((user: User) => this.updateUser(user)),
                tap((account) => this.user.next(account)),
            );
    }

    public sendVerification(): Observable<void> {
        const user = this.angularFireAuth.auth.currentUser;
        return from(user.sendEmailVerification());
    }

    public verify(code: string): Observable<User> {
        const user = this.angularFireAuth.auth.currentUser;
        const userDoc = this.angularFirestore.collection<User>('users').doc<User>(user.uid);

        return from(this.angularFireAuth.auth.applyActionCode(code))
            .pipe(
                mergeMap(() => userDoc.update({ verified: true })),
                mergeMap(() => userDoc.get()),
                map((snapshot: DocumentSnapshot<User>) => snapshot.data()),
                tap((account) => this.user.next(account)),
            );
    }

    public sendReset(email: string): Observable<void> {
        return from(this.angularFireAuth.auth.sendPasswordResetEmail(email));
    }

    public resetPassword(password: string, code: string): Observable<void> {
        return from(this.angularFireAuth.auth.verifyPasswordResetCode(code))
            .pipe(
                mergeMap((email) => {
                    return from(this.angularFireAuth.auth.confirmPasswordReset(code, password))
                        .pipe(
                            map(() => email),
                        );
                }),
                mergeMap((email) => this.signIn(email, password)),
            );
    }

    public checkLoggedIn(): Observable<User> {
        return this.angularFireAuth.authState
            .pipe(
                mergeMap((user: fireUser) => this.angularFirestore.collection<User>('users').doc<User>(user.uid).get()),
                mergeMap((snapshot: DocumentSnapshot<User>) => {
                    if (snapshot.exists) {
                        return of(snapshot.data());
                    } else {
                        const currentUser: fireUser = this.angularFireAuth.auth.currentUser;
                        const isVerified = currentUser.emailVerified;
                        const chain = isVerified ? of(null) : this.sendVerification();
                        return chain
                            .pipe(
                                map(() => this.convertToUser(currentUser)),
                                mergeMap((user: User) => this.updateUser(user)),
                            );
                    }
                }),
                map((account) => {
                    this.user.next(account);
                    return account;
                }),
            );
    }

    public logout(): Observable<void> {
        const logout = this.angularFireAuth.auth.signOut();
        return from(logout)
            .pipe(
                take(1),
                mergeMap(() => of(this.router.navigate([ '/' ]))),
                map(() => this.user.next(null)),
            );
    }

    private convertToUser(firebaseUser: fireUser): User {
        if (!firebaseUser) {
            throw new Error('no user');
        }

        const uid = firebaseUser.uid;
        const alias = firebaseUser.displayName;
        const email = firebaseUser.email;
        const avatar = firebaseUser.photoURL;
        const verified = firebaseUser.emailVerified;

        return { uid, alias, email, avatar, verified };
    }

    private updateUser(user: User): Observable<User> {
        return from(this.angularFirestore
            .collection<User>('users')
            .doc<User>(user.uid)
            .set(user, { merge: true }))
            .pipe(map(() => user));
    }

}
