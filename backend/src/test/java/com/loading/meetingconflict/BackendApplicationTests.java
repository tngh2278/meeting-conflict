package com.loading.meetingconflict;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import com.loading.meetingconfilct.BackendApplication;
import com.loading.meetingconfilct.document.DocumentTextExtractor;

@SpringBootTest(classes = BackendApplication.class, properties = {
        "SUPABASE_URL=https://auth.example.invalid",
        "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration,"
                + "org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration"
})
class BackendApplicationTests {

	@Autowired
	private DocumentTextExtractor documentTextExtractor;

	@Test
	void contextLoads() {
		assertThat(documentTextExtractor).isNotNull();
	}

}
