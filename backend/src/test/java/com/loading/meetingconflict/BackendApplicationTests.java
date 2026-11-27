package com.loading.meetingconflict;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.bean.override.convention.TestBean;

import com.loading.meetingconfilct.BackendApplication;
import com.loading.meetingconfilct.document.DocumentTextExtractor;
import com.loading.meetingconfilct.photo.MeetingPhotoFaceController;

@SpringBootTest(classes = BackendApplication.class, properties = {
		"SUPABASE_URL=https://auth.example.invalid",
		"spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration,"
				+ "org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration"
})
class BackendApplicationTests {

	// DB 자동 구성을 끈 테스트에서도 사진 API를 초기화할 수 있게 한다.
	@TestBean
	private JdbcClient jdbcClient;

	static JdbcClient jdbcClient() {
		return JdbcClient.create(new DriverManagerDataSource());
	}

	@Autowired
	private DocumentTextExtractor documentTextExtractor;

	@Autowired
	private MeetingPhotoFaceController meetingPhotoFaceController;

	@Test
	void contextLoads() {
		assertThat(documentTextExtractor).isNotNull();
		assertThat(meetingPhotoFaceController).isNotNull();
	}

}
