import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Database, ref, onValue } from '@angular/fire/database';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  userData: any = null;
  private database = inject(Database);

  ngOnInit() {
    const dbRef = ref(this.database, 'test');
    onValue(dbRef, (snapshot) => {
      if (snapshot.exists()) {
        this.userData = snapshot.val();
      }
    });
  }
}
